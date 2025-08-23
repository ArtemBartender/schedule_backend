# server.py
from __future__ import annotations

import os
import io
import re
import json
import unicodedata
from datetime import datetime, date
from calendar import monthrange

import pdfplumber
from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt
from sqlalchemy import and_, text as sqltext
from sqlalchemy.sql import func
from sqlalchemy.pool import NullPool
from sqlalchemy.exc import OperationalError, DisconnectionError
from werkzeug.security import generate_password_hash, check_password_hash

# ---------------------------------
# Config
# ---------------------------------
load_dotenv()

app = Flask(__name__, static_folder='static', template_folder='templates')

db_url = os.getenv('DATABASE_URL')
if not db_url:
    db_url = 'sqlite:///schedule.db'
elif db_url.startswith('postgres://'):
    db_url = db_url.replace('postgres://', 'postgresql+psycopg2://', 1)

app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'dev-secret-change-me')

# Движок БД
engine_opts = {'pool_pre_ping': True}
if ('pooler.supabase.com' in db_url) or os.getenv('DB_FORCE_NULLPOOL') == '1':
    engine_opts['poolclass'] = NullPool
else:
    engine_opts.update({
        'pool_recycle': int(os.getenv('DB_POOL_RECYCLE', '300')),
        'pool_size': int(os.getenv('DB_POOL_SIZE', '3')),
        'max_overflow': int(os.getenv('DB_MAX_OVERFLOW', '0')),
    })
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = engine_opts

jwt = JWTManager(app)
db = SQLAlchemy(app)

ADMIN_EMAILS = {e.strip().lower() for e in os.getenv('ADMIN_EMAILS', '').split(',') if e.strip()}

# Кто может финально утверждать замены (нижний регистр!)
MANAGER_EMAILS = {"r.czajka@lot.pl", "m.kaczmarski@lot.pl"}

# ---------------------------------
# Models
# ---------------------------------
class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=True)
    password_hash = db.Column(db.String(255), nullable=True)
    full_name = db.Column(db.String(255), unique=True, nullable=False)
    role = db.Column(db.String(50), nullable=False, default='user')
    order_index = db.Column(db.Integer, nullable=True)
    is_coordinator = db.Column(db.Boolean, nullable=False, default=False)
    is_zmiwaka = db.Column(db.Boolean, nullable=False, default=False)
    hourly_rate_pln = db.Column(db.Numeric(10, 2), nullable=True)
    tax_percent = db.Column(db.Numeric(5, 2), nullable=True, default=0)

    shifts = db.relationship('Shift', backref='user', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'full_name': self.full_name,
            'role': self.role,
            'order_index': self.order_index,
            'is_coordinator': bool(self.is_coordinator),
            'is_zmiwaka': bool(self.is_zmiwaka),
            'hourly_rate_pln': float(self.hourly_rate_pln) if self.hourly_rate_pln is not None else None,
            'tax_percent': float(self.tax_percent or 0),
        }


class Shift(db.Model):
    __tablename__ = 'shifts'
    __table_args__ = (
        db.UniqueConstraint('user_id', 'shift_date', name='uq_shifts_user_date'),
    )
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    shift_date = db.Column(db.Date, nullable=False)
    shift_code = db.Column(db.String(50), nullable=False)
    hours = db.Column(db.Integer, nullable=True)
    worked_hours = db.Column(db.Numeric(5, 2), nullable=True)
    work_note = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'full_name': self.user.full_name if self.user else None,
            'shift_date': self.shift_date.isoformat(),
            'shift_code': self.shift_code,
            'hours': self.hours,
            'worked_hours': float(self.worked_hours) if self.worked_hours is not None else None,
        }


class SwapProposal(db.Model):
    __tablename__ = 'swap_proposals'
    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    target_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    my_date = db.Column(db.Date, nullable=False)      # дата моей смены, которую отдаю
    their_date = db.Column(db.Date, nullable=False)   # дата их смены, которую хочу
    status = db.Column(db.String(20), nullable=False, default='pending')  # pending/accepted/declined/canceled/approved/rejected
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())

    requester = db.relationship('User', foreign_keys=[requester_id])
    target_user = db.relationship('User', foreign_keys=[target_user_id])

    def to_dict(self):
        return {
            'id': self.id,
            'requester': self.requester.to_dict() if self.requester else None,
            'target_user': self.target_user.to_dict() if self.target_user else None,
            'my_date': self.my_date.isoformat(),
            'their_date': self.their_date.isoformat(),
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class DayNote(db.Model):
    __tablename__ = 'day_notes'
    id = db.Column(db.Integer, primary_key=True)
    note_date = db.Column(db.Date, nullable=False, index=True)
    text = db.Column(db.Text, nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    author = db.relationship('User')

    def to_dict(self):
        return {
            'id': self.id,
            'note_date': self.note_date.isoformat(),
            'text': self.text,
            'author': self.author.full_name if self.author else None,
            'created_at': self.created_at.isoformat(timespec='seconds')
        }

# ---------------------------------
# DB init + light migrations
# ---------------------------------
with app.app_context():
    db.create_all()
    from sqlalchemy import inspect
    engine = db.engine
    insp = inspect(engine)
    backend = engine.url.get_backend_name()

    def _exec(sql, ok_msg):
        try:
            db.session.execute(sqltext(sql))
            db.session.commit()
            app.logger.info(ok_msg)
        except Exception as e:
            db.session.rollback()
            app.logger.warning(f"skip: {e}")

    # ensure columns on users
    if 'users' in insp.get_table_names():
        ucols = {c['name']: c for c in insp.get_columns('users')}
        if 'hourly_rate_pln' not in ucols:
            _exec("ALTER TABLE users ADD COLUMN hourly_rate_pln NUMERIC", "users.hourly_rate_pln added")
        if 'tax_percent' not in ucols:
            _exec("ALTER TABLE users ADD COLUMN tax_percent NUMERIC DEFAULT 0", "users.tax_percent added")

    # dedupe shifts per (user_id, date)
    try:
        dups = (db.session.query(Shift.user_id, Shift.shift_date, func.count(Shift.id))
                .group_by(Shift.user_id, Shift.shift_date)
                .having(func.count(Shift.id) > 1)
                .all())
        for uid, sdate, _ in dups:
            rows = (Shift.query
                    .filter(Shift.user_id == uid, Shift.shift_date == sdate)
                    .order_by(Shift.id.desc())
                    .all())
            for extra in rows[1:]:
                db.session.delete(extra)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        app.logger.warning(f"dedupe shifts skipped: {e}")

    # unique index
    _exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_user_date ON shifts (user_id, shift_date)",
          "uq_shifts_user_date ensured")

    # ensure flags on users
    if 'users' in insp.get_table_names():
        cols = {c['name']: c for c in insp.get_columns('users')}
        if 'order_index' not in cols:
            _exec("ALTER TABLE users ADD COLUMN order_index INTEGER", "users.order_index added")
        if 'is_coordinator' not in cols:
            _exec("ALTER TABLE users ADD COLUMN is_coordinator BOOLEAN DEFAULT FALSE NOT NULL",
                  "users.is_coordinator added")
        if 'is_zmiwaka' not in cols:
            _exec("ALTER TABLE users ADD COLUMN is_zmiwaka BOOLEAN DEFAULT FALSE NOT NULL",
                  "users.is_zmiwaka added")

        # allow null email/password in Postgres
        if backend.startswith('postgresql'):
            cols = {c['name']: c for c in insp.get_columns('users')}
            for col in ('email', 'password_hash'):
                ci = cols.get(col)
                if ci is not None and not ci.get('nullable', True):
                    _exec(f"ALTER TABLE users ALTER COLUMN {col} DROP NOT NULL",
                          f"users.{col} set NULLABLE")

    # ensure swap_proposals table (sqlite path: db.create_all() already did)
    if 'swap_proposals' not in insp.get_table_names() and backend.startswith('postgresql'):
        try:
            db.session.execute(sqltext("""
                CREATE TABLE IF NOT EXISTS swap_proposals (
                    id SERIAL PRIMARY KEY,
                    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    my_date DATE NOT NULL,
                    their_date DATE NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )"""))
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            app.logger.warning(f"swap_proposals migration skipped: {e}")

# ---------------------------------
# Helpers
# ---------------------------------
COORDINATORS_DEFAULT = {
    "Justyna Świstak", "Alicja Palczewska", "Jakub Włodarczyk", "Alicja Kupczyk",
    "Patrycja Gołebiowska", "Roman Wozniak", "Maria Romanova", "Alicja Daniel",
    "Karina Levchenko",
}
ZMIWAKI_DEFAULT = {"Tetiana Rudiuk", "Maiia Rybchynchuk"}

def _norm(s: str) -> str:
    if s is None:
        return ''
    s = s.strip().lower()
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
    return s

DATE_PATTERNS = [
    (re.compile(r'^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$'), ('d','m','y')),
    (re.compile(r'^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$'), ('y','m','d')),
]

@app.teardown_appcontext
def teardown_db(exception=None):
    try:
        db.session.remove()
    except Exception:
        pass


def db_get(model, pk):
    return db.session.get(model, pk)



@app.errorhandler(OperationalError)
def on_operational_error(e):
    app.logger.error(f"DB error: {e}")
    return jsonify({'error':'Baza danych przeciążona (połączenia). Spróbuj ponownie za chwilę.'}), 503

@app.errorhandler(DisconnectionError)
def on_disconnection(e):
    app.logger.error(f"DB disconnect: {e}")
    return jsonify({'error':'Baza danych przeciążona (rozłączenie). Spróbuj ponownie.'}), 503

def _parse_hhmm(s: str):
    s = (s or '').strip()
    if not s: return None
    try:
        hh, mm = map(int, s.split(':'))
        if not (0 <= hh < 24 and 0 <= mm < 60): return None
        return hh * 60 + mm
    except Exception:
        return None

def _minutes_to_hours_float(mins: int) -> float:
    return round((mins or 0) / 60.0, 2)

def _has_shift(user_id: int, d: date, exclude_id: int | None = None) -> bool:
    q = Shift.query.filter(Shift.user_id == user_id, Shift.shift_date == d)
    if exclude_id:
        q = q.filter(Shift.id != exclude_id)
    return db.session.query(q.exists()).scalar()

SHIFT_HOURS_DEFAULT = {
    '1': 9, '1/B': 9, '1B': 9,
    '2': 9, '2/B': 9, '2B': 9,
}
def resolve_hours(shift_obj):
    if getattr(shift_obj, 'worked_hours', None) is not None:
        try: return float(shift_obj.worked_hours or 0)
        except: return 0.0
    if shift_obj.hours is not None:
        try: return float(shift_obj.hours or 0)
        except: return 0.0
    code = (shift_obj.shift_code or '').strip().upper().replace(' ', '')
    return float(SHIFT_HOURS_DEFAULT.get(code, 0))

def default_times_for_code(code: str):
    c = (code or '').strip().upper().replace(' ', '')
    if c in ('1','1/B','1B'):
        return '04:30', '14:00'
    if c in ('2','2/B','2B'):
        return '14:00', '23:30'
    return None, None

def parse_date_fuzzy(s: str):
    s = (s or '').strip()
    for pat, order in DATE_PATTERNS:
        m = pat.match(s)
        if m:
            parts = list(map(int, m.groups()))
            d = {order[i]: parts[i] for i in range(3)}
            y = d['y'] + (2000 if d['y'] < 100 else 0)
            return date(y, d['m'], d['d'])
    try:
        return datetime.fromisoformat(s).date()
    except Exception:
        return None

def _get_user_from_jwt():
    """Возвращает (user_id, User) из JWT."""
    claims = get_jwt() or {}
    uid = int(claims["sub"])
    u = User.query.get(uid)
    return uid, u

def _is_manager(user_or_id) -> bool:
    """Менеджер = роль admin/coordinator ИЛИ email в MANAGER_EMAILS."""
    u = user_or_id
    if isinstance(u, int):
        u = User.query.get(u)
    if not u:
        return False
    email = (u.email or '').strip().lower()
    role  = (u.role  or '').strip().lower()
    return (role in ('admin', 'coordinator')) or (email in MANAGER_EMAILS)

def _shift_of(user_id, d: date):
    return Shift.query.filter(and_(Shift.user_id==user_id, Shift.shift_date==d)).first()

# ---------------------------------
# Auth
# ---------------------------------
@app.post('/api/register')
def register():
    data = request.get_json(force=True)
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    full_name = (data.get('full_name') or '').strip()

    if not email or not password or not full_name:
        return jsonify({'error': 'Pola email, password i full_name są wymagane.'}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Użytkownik z takim adresem email już istnieje.'}), 400

    existing = User.query.filter_by(full_name=full_name).first()
    if existing:
        placeholder = (existing.email or '').endswith('@auto.local')
        if existing.email is None or placeholder:
            existing.email = email
            existing.password_hash = generate_password_hash(password)
            db.session.commit()
            token = create_access_token(identity=str(existing.id),
                                        additional_claims={'role': existing.role, 'full_name': existing.full_name})
            return jsonify({'access_token': token, 'user': existing.to_dict()})
        return jsonify({'error': 'Użytkownik o takim full_name już istnieje.'}), 400

    role = 'admin' if email in ADMIN_EMAILS or User.query.count() == 0 else 'user'
    user = User(email=email, password_hash=generate_password_hash(password), full_name=full_name, role=role)
    db.session.add(user); db.session.commit()

    token = create_access_token(identity=str(user.id),
                                additional_claims={'role': user.role, 'full_name': user.full_name})
    return jsonify({'access_token': token, 'user': user.to_dict()})

@app.post('/api/login')
def login():
    data = request.get_json(force=True)
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    try:
        user = User.query.filter_by(email=email).first()
    except (OperationalError, DisconnectionError):
        return jsonify({'error': 'Baza danych chwilowo niedostępna. Spróbuj ponownie później.'}), 503

    if not user or not user.password_hash or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Nieprawidłowy email lub hasło.'}), 401

    token = create_access_token(identity=str(user.id),
                                additional_claims={'role': user.role, 'full_name': user.full_name})
    return jsonify({'access_token': token, 'user': user.to_dict()})

# ---------------------------------
# User settings & stats
# ---------------------------------
@app.get('/api/me/settings')
@jwt_required()
def me_settings_get():
    uid = int(get_jwt()['sub'])
    u = User.query.get(uid)
    return jsonify({
        'hourly_rate_pln': float(u.hourly_rate_pln) if u and u.hourly_rate_pln is not None else None,
        'tax_percent': float(u.tax_percent or 0)
    })

@app.post('/api/me/settings')
@jwt_required()
def me_settings_set():
    uid = int(get_jwt()['sub'])
    u = User.query.get(uid)
    data = request.get_json(force=True)
    try:
        rate = data.get('hourly_rate_pln', None)
        tax  = data.get('tax_percent', 0)
        u.hourly_rate_pln = None if rate in (None, '') else float(rate)
        u.tax_percent     = float(tax or 0)
        db.session.commit()
        return jsonify({'ok': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Błąd zapisu ustawień: {e}'}), 400

@app.get('/api/my-stats')
@jwt_required()
def my_stats():
    uid = int(get_jwt()['sub'])
    month = (request.args.get('month') or '').strip()  # 'YYYY-MM'
    if month:
        y, m = map(int, month.split('-'))
        start = date(y, m, 1)
        end   = date(y, m, monthrange(y, m)[1])
    else:
        try:
            start = datetime.fromisoformat(request.args.get('from')).date()
            end   = datetime.fromisoformat(request.args.get('to')).date()
        except Exception:
            return jsonify({'error':'Zły zakres dat.'}), 400

    shifts = (Shift.query
              .filter(Shift.user_id==uid, Shift.shift_date>=start, Shift.shift_date<=end)
              .order_by(Shift.shift_date.asc())
              .all())

    u = User.query.get(uid)
    rate = float(u.hourly_rate_pln) if u and u.hourly_rate_pln is not None else 0.0
    tax  = float(u.tax_percent or 0)

    today = date.today()
    total_hours = 0
    done_hours  = 0
    daily = []
    for s in shifts:
        h = resolve_hours(s)
        total_hours += h
        is_done = s.shift_date <= today
        if is_done: done_hours += h
        gross = h * rate
        net   = gross * (1 - tax/100.0)
        daily.append({
            'date': s.shift_date.isoformat(),
            'code': s.shift_code,
            'hours': h,
            'done': bool(is_done),
            'gross': round(gross,2),
            'net': round(net,2),
        })

    left_hours = max(total_hours - done_hours, 0)
    gross_done = round(done_hours * rate, 2)
    net_done   = round(gross_done * (1 - tax/100.0), 2)
    gross_all  = round(total_hours * rate, 2)
    net_all    = round(gross_all * (1 - tax/100.0), 2)

    return jsonify({
        'range': {'from': start.isoformat(), 'to': end.isoformat()},
        'rate_pln': rate, 'tax_percent': tax,
        'hours_total': total_hours,
        'hours_done': done_hours,
        'hours_left': left_hours,
        'gross_done': gross_done,
        'net_done': net_done,
        'gross_all': gross_all,
        'net_all': net_all,
        'daily': daily
    })

# ---------------------------------
# Shifts & notes
# ---------------------------------
@app.get('/api/my-shifts')
@jwt_required()
def my_shifts():
    user_id = int((get_jwt() or {})["sub"])
    shifts = (Shift.query
              .filter(Shift.user_id == user_id)
              .order_by(Shift.shift_date.asc())
              .all())
    return jsonify([s.to_dict() for s in shifts])

@app.get('/api/day-shifts')
@jwt_required()
def day_shifts():
    d_str = request.args.get('date', '')
    try:
        d = datetime.fromisoformat(d_str).date()
    except Exception:
        return jsonify({'error': 'Nieprawidłowa data.'}), 400

    backend = db.engine.url.get_backend_name()
    COORD = set(COORDINATORS_DEFAULT)
    ZMIW  = set(ZMIWAKI_DEFAULT)

    base_q = Shift.query.join(User).filter(Shift.shift_date == d)
    if backend.startswith('postgresql'):
        q = base_q.order_by(User.order_index.asc().nulls_last(), User.full_name.asc())
    else:
        from sqlalchemy import case
        q = base_q.order_by(
            case((User.order_index.is_(None), 1), else_=0),
            User.order_index.asc(),
            User.full_name.asc()
        )

    rows = q.all()

    def is_evening(code: str) -> bool:
        return (code or '').strip().upper().startswith('2')
    def is_morning(code: str) -> bool:
        return (code or '').strip().upper().startswith('1')

    morning, evening = [], []
    for s in rows:
        u = s.user
        full_name = u.full_name if u else None
        item = {
            'user_id': u.id if u else None,
            'full_name': full_name,
            'shift_code': s.shift_code,
            'hours': s.hours,
            'order_index': getattr(u, 'order_index', None),
            'is_coordinator': bool(getattr(u, 'is_coordinator', False) or (full_name in COORD)),
            'is_zmiwaka':    bool(getattr(u, 'is_zmiwaka', False)    or (full_name in ZMIW)),
        }
        if is_evening(s.shift_code):
            evening.append(item)
        elif is_morning(s.shift_code):
            morning.append(item)

    return jsonify({'date': d.isoformat(), 'morning': morning, 'evening': evening})

@app.get('/api/shifts')
@jwt_required()
def get_all_shifts():
    backend = db.engine.url.get_backend_name()
    COORD = set(COORDINATORS_DEFAULT)
    ZMIW  = set(ZMIWAKI_DEFAULT)

    base_q = Shift.query.join(User)
    if backend.startswith('postgresql'):
        q = base_q.order_by(Shift.shift_date.asc(), User.order_index.asc().nulls_last(), User.full_name.asc())
    else:
        from sqlalchemy import case
        q = base_q.order_by(
            Shift.shift_date.asc(),
            case((User.order_index.is_(None), 1), else_=0),
            User.order_index.asc(),
            User.full_name.asc()
        )

    shifts = q.all()
    out = []
    for s in shifts:
        u = s.user
        full_name = u.full_name if u else None
        d = s.to_dict()
        d.update({
            'order_index': getattr(u, 'order_index', None),
            'is_coordinator': bool(getattr(u, 'is_coordinator', False) or (full_name in COORD)),
            'is_zmiwaka':    bool(getattr(u, 'is_zmiwaka', False)    or (full_name in ZMIW)),
        })
        out.append(d)
    return jsonify(out)

@app.get('/api/my-shifts-brief')
@jwt_required()
def my_shifts_brief():
    uid = int(get_jwt()['sub'])
    month = (request.args.get('month') or '').strip()  # 'YYYY-MM'
    if not month:
        today = date.today()
        y, m = today.year, today.month
    else:
        y, m = map(int, month.split('-'))
    start = date(y, m, 1)
    end   = date(y, m, monthrange(y, m)[1])

    rows = (Shift.query
            .filter(Shift.user_id==uid, Shift.shift_date>=start, Shift.shift_date<=end)
            .order_by(Shift.shift_date.asc())
            .all())

    out = []
    for s in rows:
        out.append({
            'id': s.id,
            'date': s.shift_date.isoformat(),
            'code': s.shift_code,
            'scheduled_hours': float(s.hours) if s.hours is not None else float(SHIFT_HOURS_DEFAULT.get((s.shift_code or '').strip().upper().replace(' ', ''), 0)),
            'worked_hours': float(s.worked_hours) if s.worked_hours is not None else None,
            'note_preview': (s.work_note[:120] + '…') if s.work_note and len(s.work_note) > 120 else (s.work_note or '')
        })
    return jsonify(out)

@app.get('/api/my-shift/<int:sid>')
@jwt_required()
def my_shift_get(sid):
    uid = int(get_jwt()['sub'])
    s = Shift.query.get(sid)
    if not s or s.user_id != uid:
        return jsonify({'error':'Nie znaleziono zmiany.'}), 404
    start_hint, end_hint = default_times_for_code(s.shift_code)
    return jsonify({
        'id': s.id,
        'date': s.shift_date.isoformat(),
        'code': s.shift_code,
        'scheduled_hours': float(s.hours) if s.hours is not None else float(SHIFT_HOURS_DEFAULT.get((s.shift_code or '').strip().upper().replace(' ', ''), 0)),
        'worked_hours': float(s.worked_hours) if s.worked_hours is not None else None,
        'note': s.work_note or '',
        'default_start': start_hint,
        'default_end': end_hint
    })

@app.get('/api/next-shift')
@jwt_required()
def next_shift():
    uid = int(get_jwt()['sub'])
    today = date.today()
    s = (Shift.query
         .filter(Shift.user_id == uid, Shift.shift_date >= today)
         .order_by(Shift.shift_date.asc())
         .first())
    if not s:
        s = (Shift.query
             .filter(Shift.user_id == uid)
             .order_by(Shift.shift_date.desc())
             .first())
        if not s:
            return jsonify({'empty': True})

    y, m = s.shift_date.year, s.shift_date.month
    month_shifts = (Shift.query
                    .filter(Shift.user_id == uid,
                            Shift.shift_date >= date(y, m, 1),
                            Shift.shift_date <= date(y, m, monthrange(y, m)[1]))
                    .all())
    total = len(month_shifts)
    done  = sum(1 for x in month_shifts if x.shift_date <= today)

    return jsonify({
        'date': s.shift_date.isoformat(),
        'code': s.shift_code,
        'hours': resolve_hours(s),
        'month_total': total,
        'month_done':  done
    })

# -------- Day Notes --------
def _is_coord_or_admin():
    claims = get_jwt() or {}
    return (claims.get('role') or '').lower() in ('admin', 'coordinator')

@app.get('/api/day-notes')
@jwt_required()
def day_notes_list():
    d = parse_date_fuzzy(request.args.get('date', ''))
    if not d:
        return jsonify({'error':'Zła data'}), 400
    rows = (DayNote.query
            .filter(DayNote.note_date == d)
            .order_by(DayNote.created_at.asc())
            .all())
    return jsonify([r.to_dict() for r in rows])

@app.post('/api/day-notes')
@jwt_required()
def day_notes_add():
    if not _is_coord_or_admin():
        return jsonify({'error':'Tylko koordynator lub admin'}), 403
    data = request.get_json(force=True)
    d = parse_date_fuzzy(data.get('date'))
    txt = (data.get('text') or '').strip()
    if not d or not txt:
        return jsonify({'error':'Brak danych'}), 400
    uid = int(get_jwt()['sub'])
    note = DayNote(note_date=d, text=txt, author_id=uid)
    db.session.add(note); db.session.commit()
    return jsonify(note.to_dict())

@app.delete('/api/day-notes/<int:nid>')
@jwt_required()
def day_notes_delete(nid):
    note = DayNote.query.get(nid)
    if not note:
        return jsonify({'error':'Nie znaleziono'}), 404
    if not _is_coord_or_admin():
        return jsonify({'error':'Tylko koordynator lub admin'}), 403
    db.session.delete(note); db.session.commit()
    return jsonify({'ok': True})

# -------- Worklog --------
@app.post('/api/my-shift/<int:sid>/worklog')
@jwt_required()
def my_shift_save_worklog(sid):
    uid = int(get_jwt()['sub'])
    s = Shift.query.get(sid)
    if not s or s.user_id != uid:
        return jsonify({'error':'Nie znaleziono zmiany.'}), 404

    data = request.get_json(force=True)
    worked_hours = data.get('worked_hours', None)
    start_hhmm = data.get('start_time', '')
    end_hhmm   = data.get('end_time', '')
    note       = (data.get('note') or '').strip()

    calc_hours = None
    if (start_hhmm and end_hhmm):
        start_m = _parse_hhmm(start_hhmm)
        end_m   = _parse_hhmm(end_hhmm)
        if start_m is None or end_m is None:
            return jsonify({'error':'Zły format czasu (HH:MM).'}), 400
        if end_m < start_m:
            end_m += 24*60
        calc_hours = _minutes_to_hours_float(end_m - start_m)

    try:
        if worked_hours in (None, ''):
            if calc_hours is not None:
                s.worked_hours = calc_hours
        else:
            s.worked_hours = float(worked_hours)
        s.work_note = note or None
        db.session.commit()
        return jsonify({'ok': True, 'worked_hours': float(s.worked_hours) if s.worked_hours is not None else None})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Błąd zapisu: {e}'}), 400

@app.get('/api/my-notes')
@jwt_required()
def my_notes_month():
    uid = int(get_jwt()['sub'])
    month = (request.args.get('month') or '').strip()  # 'YYYY-MM'
    if not month:
        today = date.today(); y, m = today.year, today.month
    else:
        y, m = map(int, month.split('-'))
    start = date(y, m, 1); end = date(y, m, monthrange(y, m)[1])

    rows = (Shift.query
            .filter(Shift.user_id==uid, Shift.shift_date>=start, Shift.shift_date<=end, Shift.work_note.isnot(None))
            .order_by(Shift.shift_date.asc())
            .all())
    return jsonify([{'date': s.shift_date.isoformat(), 'note': s.work_note} for s in rows])

# ---------------------------------
# Proposals (swap requests)
# ---------------------------------
@app.post('/api/proposals')
@jwt_required()
def create_proposal():
    user_id, _ = _get_user_from_jwt()
    data = request.get_json(force=True)

    target_user_id = int(data.get('target_user_id'))
    my_date = parse_date_fuzzy(data.get('my_date'))
    their_date = parse_date_fuzzy(data.get('their_date'))

    if not target_user_id or not my_date or not their_date:
        return jsonify({'error': 'Pola target_user_id, my_date, their_date są wymagane.'}), 400
    if target_user_id == user_id:
        return jsonify({'error': 'Nie można proponować wymiany samemu sobie.'}), 400

    # в целевых датах не должно быть «третьих» смен
    if _has_shift(user_id, their_date):
        return jsonify({'error': 'Masz już zmianę w żądanym dniu — wymiana niemożliwa.'}), 400
    if _has_shift(target_user_id, my_date):
        return jsonify({'error': 'Wybrany pracownik ma już zmianę w Twoim dniu — wymiana niemożliwa.'}), 400

    my_shift = _shift_of(user_id, my_date)
    their_shift = _shift_of(target_user_id, their_date)
    if not my_shift:
        return jsonify({'error': 'Nie masz zmiany w tej dacie.'}), 400
    if not their_shift:
        return jsonify({'error': 'Wybrany pracownik nie ma zmiany w tej dacie.'}), 400

    exists = (SwapProposal.query
              .filter_by(requester_id=user_id, target_user_id=target_user_id,
                         my_date=my_date, their_date=their_date, status='pending')
              .first())
    if exists:
        return jsonify({'error': 'Taka propozycja została już wysłana.'}), 400

    sp = SwapProposal(
        requester_id=user_id,
        target_user_id=target_user_id,
        my_date=my_date,
        their_date=their_date,
        status='pending'
    )
    db.session.add(sp)
    db.session.commit()
    return jsonify({'proposal': sp.to_dict()})

@app.get('/api/proposals')
@jwt_required()
def list_proposals():
    uid, user = _get_user_from_jwt()

    incoming = (SwapProposal.query
                .filter(and_(SwapProposal.target_user_id == uid,
                             SwapProposal.status.in_(['pending', 'accepted', 'declined', 'approved', 'rejected', 'canceled'])))
                .order_by(SwapProposal.created_at.desc())
                .all())

    outgoing = (SwapProposal.query
                .filter(and_(SwapProposal.requester_id == uid,
                             SwapProposal.status.in_(['pending', 'accepted', 'declined', 'approved', 'rejected', 'canceled'])))
                .order_by(SwapProposal.created_at.desc())
                .all())

    resp = {
        'incoming': [p.to_dict() for p in incoming],
        'outgoing': [p.to_dict() for p in outgoing],
    }

    if _is_manager(user):
        queue = (SwapProposal.query
                 .filter(SwapProposal.status == 'accepted')
                 .order_by(SwapProposal.created_at.desc())
                 .all())
        resp['for_approval'] = [p.to_dict() for p in queue]
        resp['to_approve'] = resp['for_approval']  # alias для фронта
    else:
        resp['for_approval'] = []

    return jsonify(resp)

@app.post('/api/proposals/<int:pid>/cancel')
@jwt_required()
def cancel_proposal(pid):
    user_id, _ = _get_user_from_jwt()
    p = SwapProposal.query.get(pid)
    if not p:
        return jsonify({'error': 'Nie znaleziono.'}), 404
    if p.requester_id != user_id:
        return jsonify({'error': 'Tylko autor może anulować.'}), 403
    if p.status != 'pending':
        return jsonify({'error': 'Propozycja została już rozpatrzona.'}), 400
    p.status = 'canceled'
    db.session.commit()
    return jsonify({'proposal': p.to_dict()})

@app.post('/api/proposals/<int:pid>/decline')
@jwt_required()
def decline_proposal(pid):
    user_id, _ = _get_user_from_jwt()
    p = SwapProposal.query.get(pid)
    if not p:
        return jsonify({'error': 'Nie znaleziono.'}), 404
    if p.target_user_id != user_id:
        return jsonify({'error': 'Możesz odrzucać tylko swoje przychodzące propozycje.'}), 403
    if p.status != 'pending':
        return jsonify({'error': 'Propozycja została już rozpatrzona.'}), 400
    p.status = 'declined'
    db.session.commit()
    return jsonify({'proposal': p.to_dict()})

@app.post('/api/proposals/<int:pid>/accept')
@jwt_required()
def accept_proposal(pid):
    # получатель подтверждает → только статус accepted, БЕЗ обмена сменами
    user_id, _ = _get_user_from_jwt()
    p = SwapProposal.query.get(pid)
    if not p:
        return jsonify({'error': 'Nie znaleziono.'}), 404
    if p.target_user_id != user_id:
        return jsonify({'error': 'Możesz akceptować tylko swoje przychodzące propozycje.'}), 403
    if p.status != 'pending':
        return jsonify({'error': 'Propozycja została już rozpatrzona.'}), 400

    # ревалидация
    s_req = _shift_of(p.requester_id, p.my_date)
    s_tgt = _shift_of(p.target_user_id, p.their_date)
    if not s_req or not s_tgt:
        return jsonify({'error': 'Zmiany uległy zmianie — wymiana niemożliwa.'}), 409
    if _has_shift(p.requester_id, p.their_date):
        return jsonify({'error': 'Autor ma już zmianę w docelowym dniu.'}), 409
    if _has_shift(p.target_user_id, p.my_date):
        return jsonify({'error': 'Pracownik ma już zmianę w docelowym dniu.'}), 409

    p.status = 'accepted'
    db.session.commit()
    return jsonify({'proposal': p.to_dict()})

@app.post('/api/proposals/<int:pid>/approve')
@jwt_required()
def approve_proposal(pid):
    _, user = _get_user_from_jwt()
    if not _is_manager(user):
        return jsonify({'error': 'Tylko przełożony może zatwierdzać.'}), 403

    p = db_get(SwapProposal, pid)
    if not p:
        return jsonify({'error': 'Nie znaleziono.'}), 404
    if p.status != 'accepted':
        return jsonify({'error': 'Propozycja nie jest w stanie do zatwierdzenia.'}), 400

    s_req = _shift_of(p.requester_id, p.my_date)
    s_tgt = _shift_of(p.target_user_id, p.their_date)

    def reject_with(reason):
        p.status = 'rejected'
        db.session.commit()
        return jsonify({'error': reason, 'proposal': p.to_dict()}), 409

    if not s_req or not s_tgt:
        return reject_with('Zmiany uległy zmianie — wymiana niemożliwa.')

    if _has_shift(p.requester_id, p.their_date, exclude_id=s_tgt.id if s_tgt else None):
        return reject_with('Autor ma już zmianę w docelowym dniu.')

    if _has_shift(p.target_user_id, p.my_date, exclude_id=s_req.id if s_req else None):
        return reject_with('Pracownik ma już zmianę w docelowym dniu.')

    s_req.user_id, s_tgt.user_id = p.target_user_id, p.requester_id
    p.status = 'approved'
    db.session.commit()
    return jsonify({'proposal': p.to_dict()})


@app.post('/api/proposals/<int:pid>/reject')
@jwt_required()
def reject_proposal(pid):
    _, user = _get_user_from_jwt()
    if not _is_manager(user):
        return jsonify({'error': 'Tylko przełożony może odrzucać.'}), 403
    p = SwapProposal.query.get(pid)
    if not p:
        return jsonify({'error': 'Nie znaleziono.'}), 404
    if p.status != 'accepted':
        return jsonify({'error': 'Propozycja nie jest w stanie do odrzucenia.'}), 400
    p.status = 'rejected'
    db.session.commit()
    return jsonify({'proposal': p.to_dict()})

# ---------------------------------
# Imports (PDF / text)
# ---------------------------------
def map_headers(header_row):
    idx = {'name': None, 'date': None, 'shift': None, 'hours': None}
    NAME_KEYS = {"name","full name","fullname","full_name","employee","pracownik","nazwisko i imię","imię"}
    DATE_KEYS = {"date","data","termin","dzień","dzien"}
    SHIFT_KEYS = {"shift","zmiana","shift_code","kod"}
    HOURS_KEYS = {"hours","godziny"}
    for i, h in enumerate(header_row):
        key = _norm(str(h))
        if key in NAME_KEYS and idx['name'] is None:
            idx['name'] = i
        elif key in DATE_KEYS and idx['date'] is None:
            idx['date'] = i
        elif key in SHIFT_KEYS and idx['shift'] is None:
            idx['shift'] = i
        elif key in HOURS_KEYS and idx['hours'] is None:
            idx['hours'] = i
    ok = idx['name'] is not None and idx['date'] is not None
    return idx if ok else None

def extract_rows_from_pdf(file_bytes: bytes):
    rows = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables() or []
            for table in tables:
                if not table or len(table) < 2:
                    continue
                header = [(c or '').strip() for c in table[0]]
                mapping = map_headers(header)
                if not mapping:
                    continue
                for raw in table[1:]:
                    raw = list(raw) + [None] * (len(header) - len(raw))
                    name = (raw[mapping['name']] or '').strip()
                    dstr = (raw[mapping['date']] or '').strip()
                    shift = (raw[mapping['shift']] or '').strip() if mapping['shift'] is not None else ''
                    hours_val = None
                    if mapping['hours'] is not None and raw[mapping['hours']]:
                        try:
                            hours_val = int(str(raw[mapping['hours']]).strip())
                        except Exception:
                            hours_val = None
                    rows.append({'name': name, 'date': dstr, 'shift': shift, 'hours': hours_val})
    return rows

def extract_rows_from_pasted_text(text: str):
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    rows = []
    data_lines = []
    for ln in lines:
        if re.match(r'^(PLAN|BRAKI)\b', ln, flags=re.I): continue
        if re.match(r'^\d{1,2}[,./-]\d{1,2}$', ln): continue
        data_lines.append(ln)

    month = None
    for ln in lines:
        m = re.findall(r'(\d{1,2})[,.\/-](\d{1,2})', ln)
        if m and len(m) >= 10:
            month = int(m[0][1]); break
    if not month:
        month = datetime.now().month

    for ln in data_lines:
        parts = ln.split()
        if len(parts) <= 2: continue
        name_tokens = []
        i = 0
        while i < len(parts):
            tok = parts[i]
            if re.fullmatch(r'[xX]|(?:[12](?:/B)?)|B', tok, flags=re.I):
                break
            name_tokens.append(tok); i += 1
        if not name_tokens: continue
        name = ' '.join(name_tokens).strip()
        day = 1
        while i < len(parts):
            tok = parts[i]
            if re.fullmatch(r'[xX]|(?:[12](?:/B)?)|B', tok, flags=re.I):
                code = tok.upper()
                if code != 'X':
                    try:
                        d = date(datetime.now().year, month, day)
                    except Exception:
                        break
                    rows.append({'name': name, 'date': d.isoformat(), 'shift': code, 'hours': None})
                day += 1
                i += 1
            else:
                break
    return rows

@app.post('/api/upload-pdf')
@jwt_required()
def upload_pdf():
    claims = get_jwt() or {}
    if (claims.get('role') or '').lower() != 'admin':
        return jsonify({'error': 'Tylko administrator może przesyłać PDF.'}), 403

    if 'file' not in request.files:
        return jsonify({'error': 'Nie znaleziono pliku (form-data: file).'}), 400
    f = request.files['file']
    if not f or f.filename == '':
        return jsonify({'error': 'Pusta nazwa pliku.'}), 400

    data = f.read()
    try:
        rows = extract_rows_from_pdf(data)
    except Exception as e:
        return jsonify({'error': f'Błąd odczytu PDF: {e}'}), 400

    first_seen = {}
    seq = 0
    for r in rows:
        nm = (r.get('name') or '').strip()
        if nm and nm not in first_seen:
            first_seen[nm] = seq; seq += 1

    users_by_key = {_norm(u.full_name): u for u in User.query.all()}
    Shift.query.delete()

    imported = 0
    created_users = []
    seen_pairs = set()

    for r in rows:
        name = (r.get('name') or '').strip()
        if not name: continue
        key = _norm(name)
        user = users_by_key.get(key)
        if not user:
            user = User(full_name=name, role='user')
            db.session.add(user); db.session.flush()
            users_by_key[key] = user
            created_users.append(user.full_name)

        if name in first_seen:
            user.order_index = first_seen[name]

        d = parse_date_fuzzy(r.get('date'))
        if not d: continue
        shift_code = (r.get('shift') or '').strip() or '—'
        hours = r.get('hours')
        if hours is None: hours = 0

        pair = (user.id, d)
        if pair in seen_pairs: continue
        seen_pairs.add(pair)

        db.session.add(Shift(user_id=user.id, shift_date=d, shift_code=shift_code, hours=hours))
        imported += 1

    db.session.commit()
    app.logger.info("INFO: Imported: %s, created_users: %s", imported, len(created_users))
    return jsonify({'imported': imported, 'created_users': created_users})

@app.post('/api/upload-text')
@jwt_required()
def upload_text():
    claims = get_jwt() or {}
    if (claims.get('role') or '').lower() != 'admin':
        return jsonify({'error': 'Tylko administrator może przesyłać tekst.'}), 403

    data = request.get_json(force=True)
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Pusty tekst.'}), 400

    try:
        rows = extract_rows_from_pasted_text(text)
    except Exception as e:
        return jsonify({'error': f'Błąd parsowania тексту: {e}'}), 400

    app.logger.info("INFO: TEXT rows parsed: %s", len(rows))

    first_seen = {}
    seq = 0
    for r in rows:
        nm = (r.get('name') or '').strip()
        if nm and nm not in first_seen:
            first_seen[nm] = seq; seq += 1

    users_by_key = {_norm(u.full_name): u for u in User.query.all()}
    Shift.query.delete()

    imported = 0
    created_users = []
    seen_pairs = set()

    for r in rows:
        name = (r.get('name') or '').strip()
        if not name: continue
        key = _norm(name)
        user = users_by_key.get(key)
        if not user:
            user = User(full_name=name, role='user')
            db.session.add(user); db.session.flush()
            users_by_key[key] = user
            created_users.append(user.full_name)

        if name in first_seen:
            user.order_index = first_seen[name]

        d = parse_date_fuzzy(r.get('date'))
        if not d: continue
        shift_code = (r.get('shift') or '').strip() or '—'
        hours = r.get('hours')

        pair = (user.id, d)
        if pair in seen_pairs: continue
        seen_pairs.add(pair)

        db.session.add(Shift(user_id=user.id, shift_date=d, shift_code=shift_code, hours=hours))
        imported += 1

    db.session.commit()
    return jsonify({'imported': imported, 'created_users': created_users})

# ---------------------------------
# Pages
# ---------------------------------
@app.get('/')
def index_page():
    return render_template('index.html')

@app.get('/dashboard')
def dashboard_page():
    return render_template('dashboard.html')

@app.get('/admin')
def admin_page():
    return render_template('admin.html')

@app.get('/stats')
def stats_page():
    return render_template('stats.html')

@app.get('/api/health')
def health():
    return jsonify({'ok': True, 'ts': datetime.utcnow().isoformat()})

@app.get('/start')
def start_page():
    return render_template('start.html')

@app.get('/proposals')
def proposals_page():
    return render_template('proposals.html')

if __name__ == '__main__':
    port = int(os.getenv('PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False)
