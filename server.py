import os
import io
import logging
from datetime import datetime, timedelta, date
from functools import wraps
from logging.handlers import RotatingFileHandler

from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Date, DateTime, Boolean,
    ForeignKey, Text, and_, or_
)
from sqlalchemy.orm import sessionmaker, relationship, declarative_base
from flask_jwt_extended import (
    create_access_token, jwt_required, get_jwt_identity, JWTManager, get_jwt
)
from flask_cors import CORS
import pdfplumber
import qrcode
from io import BytesIO
import base64

# =========================
#  НАСТРОЙКА ПРИЛОЖЕНИЯ
# =========================
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Настройка логирования
handler = RotatingFileHandler('app.log', maxBytes=10000, backupCount=3)
handler.setLevel(logging.INFO)
app.logger.addHandler(handler)

# Конфигурация из переменных окружения
DATABASE_URI = os.environ.get('DATABASE_URI')
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')

if not DATABASE_URI or not JWT_SECRET_KEY:
    print("!!! CRITICAL ERROR: DATABASE_URI or JWT_SECRET_KEY not set in environment variables.")
    # Для локальной разработки
    # DATABASE_URI = "postgresql://USER:PASSWORD@HOST:PORT/DBNAME"
    # JWT_SECRET_KEY = "dev-secret"

app.config['JWT_SECRET_KEY'] = JWT_SECRET_KEY
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=30) # Увеличим срок жизни токена

# Настройка базы данных
engine = create_engine(DATABASE_URI)
Session = sessionmaker(bind=engine)
Base = declarative_base()
jwt = JWTManager(app)


# =========================
#  БЕЛЫЙ СПИСОК/РОЛИ
# =========================
ALLOWED_EMAILS = {
    "r.czajka@lot.pl", "k.koszut-gawryszak@lot.pl", "a.daniel@lot.pl", "m.kaczmarski@lot.pl",
    "k.levchenko@lot.pl", "p.tomaszewska@lot.pl", "a.palczewska@lot.pl", "j.cioch@lot.pl",
    "t.rudiuk@lot.pl", "m.rybchynchuk@lot.pl", "m.romanova@lot.pl", "r.vozniak@lot.pl",
    "a.bilenko@lot.pl", "a.makiunychuk@lot.pl", "m.cieplucha@lot.pl", "i.frejnik@lot.pl",
    "p.golebiowska@lot.pl", "a.tkachenko@lot.pl", "y.hizhetska@lot.pl", "s.burghardt@lot.pl",
    "a.yakymenko@lot.pl", "a.mazur@lot.pl", "k.iskova@lot.pl", "m.titarenko@lot.pl",
    "v.zaitseva@lot.pl", "j.krzymieniewski@lot.pl", "m.fraczyk@lot.pl", "m.lejza@lot.pl",
    "l.sulkowski@lot.pl", "v.nadiuk@lot.pl", "y.makivnychuk@lot.pl", "n.godzisz@lot.pl",
    "d.shapoval@lot.pl", "d.solop@lot.pl", "a.kupczyk@lot.pl", "j.wlodarczyk@lot.pl",
    "a.buska@lot.pl", "w.utko@lot.pl", "o.grabowska@lot.pl", "a.jankowska@lot.pl",
    "w.skorupska@lot.pl", "p.paskudzka@lot.pl", "m.zukowska@lot.pl", "s.paczkowska@lot.pl",
    "m.demko@lot.pl", "z.kornacka@lot.pl", "r.nowacka@lot.pl", "k.janikiewicz@lot.pl"
}
ADMIN_EMAILS = {
    "r.czajka@lot.pl", "k.koszut-gawryszak@lot.pl", "m.kaczmarski@lot.pl", "a.bilenko@lot.pl",
}
SHIFT_HOURS = {
    "1": 9.5, "1/B": 9.5, "2": 9.5, "2/B": 9.5,
    "W": 0.0, "O": 0.0, "CH": 0.0
}


# =========================
#         МОДЕЛИ
# =========================
class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, unique=True, nullable=False)
    role = Column(String, default='user', nullable=False)
    phone = Column(String, nullable=True)
    fcm_token = Column(String, nullable=True)
    shifts = relationship('Shift', back_populates='user', cascade="all, delete-orphan")
    outgoing_swaps = relationship('SwapRequest', foreign_keys='SwapRequest.from_user_id', back_populates='from_user')
    incoming_swaps = relationship('SwapRequest', foreign_keys='SwapRequest.to_user_id', back_populates='to_user')
    def set_password(self, password): self.password_hash = generate_password_hash(password)
    def check_password(self, password): return check_password_hash(self.password_hash, password)

class Shift(Base):
    __tablename__ = 'shifts'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    shift_date = Column(Date, nullable=False)
    shift_code = Column(String, nullable=False)
    hours = Column(Float, nullable=False)
    is_coordinator = Column(Boolean, default=False, nullable=False)
    color_hex = Column(String, nullable=True)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)
    qr_code = Column(String, nullable=True)
    user = relationship('User', back_populates='shifts')
    def to_dict(self):
        return {
            "id": self.id, "date": self.shift_date.strftime('%Y-%m-%d'),
            "shift_code": self.shift_code, "hours": self.hours,
            "isCoordinator": bool(self.is_coordinator), "colorHex": self.color_hex,
            "actualStart": self.actual_start.isoformat() if self.actual_start else None,
            "actualEnd": self.actual_end.isoformat() if self.actual_end else None
        }

class SwapRequest(Base):
    __tablename__ = 'swap_requests'
    id = Column(Integer, primary_key=True)
    from_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    to_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    from_shift_id = Column(Integer, ForeignKey('shifts.id', ondelete='CASCADE'), nullable=False)
    to_shift_id = Column(Integer, ForeignKey('shifts.id', ondelete='SET NULL'), nullable=True)
    status = Column(String, default='pending', nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    from_user = relationship('User', foreign_keys=[from_user_id], back_populates='outgoing_swaps')
    to_user = relationship('User', foreign_keys=[to_user_id], back_populates='incoming_swaps')
    from_shift = relationship('Shift', foreign_keys=[from_shift_id])
    to_shift = relationship('Shift', foreign_keys=[to_shift_id])
    def to_dict(self):
        return {
            "id": self.id, "status": self.status, "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "from_user": self.from_user.full_name if self.from_user else None,
            "to_user": self.to_user.full_name if self.to_user else None,
            "from_shift": self.from_shift.to_dict() if self.from_shift else None,
            "to_shift": self.to_shift.to_dict() if self.to_shift else None
        }

# ... (Здесь могут быть другие модели, такие как Notification, TimeOffRequest и т.д.)


# =========================
#  ДЕКОРАТОР: только админ
# =========================
def admin_required():
    def wrapper(fn):
        @wraps(fn)
        @jwt_required()
        def decorator(*args, **kwargs):
            claims = get_jwt()
            if claims.get('role') == 'admin':
                return fn(*args, **kwargs)
            else:
                return jsonify(msg="Wymagane uprawnienia administratora!"), 403
        return decorator
    return wrapper


# =========================
#       АВТОРИЗАЦИЯ
# =========================
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = (data.get('email') or "").strip().lower()
    password = data.get('password')
    full_name = (data.get('full_name') or "").strip()

    if not all([email, password, full_name]):
        return jsonify({"msg": "Brakujący email, hasło lub imię i nazwisko"}), 400
    if email not in ALLOWED_EMAILS:
        return jsonify({"msg": "Ten email nie jest autoryzowany"}), 403

    session = Session()
    try:
        if session.query(User).filter(User.email.ilike(email)).first() or \
           session.query(User).filter(User.full_name.ilike(full_name)).first():
            return jsonify({"msg": "Użytkownik z tym adresem email lub imieniem już istnieje"}), 409
        
        new_user = User(email=email, full_name=full_name)
        new_user.set_password(password)
        if email in ADMIN_EMAILS:
            new_user.role = 'admin'
        
        session.add(new_user)
        session.commit()
        return jsonify({"msg": "Użytkownik utworzony pomyślnie"}), 201
    finally:
        session.close()


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = (data.get('email') or "").strip().lower()
    password = data.get('password')

    session = Session()
    try:
        user = session.query(User).filter(User.email.ilike(email)).first()
        if user and user.check_password(password):
            additional_claims = {"role": user.role}
            token = create_access_token(identity=user.id, additional_claims=additional_claims)
            return jsonify(access_token=token)
        return jsonify({"msg": "Nieprawidłowy email lub hasło"}), 401
    finally:
        session.close()


# =========================
#   ЗАГРУЗКА PDF-ГРАФИКА
# =========================
@app.route('/schedule/upload', methods=['POST'])
@admin_required()
def upload_schedule():
    if 'file' not in request.files: return jsonify({"error": "Brak pliku"}), 400
    file = request.files['file']
    if not file or file.filename == '': return jsonify({"error": "Nie wybrano pliku"}), 400

    try:
        filename_parts = file.filename.split('_')
        year = int(filename_parts[-2])
        month = int(filename_parts[-1].split('.')[0])
    except (IndexError, ValueError):
        return jsonify({"error": "Nieprawidłowy format nazwy pliku. Oczekiwano 'nazwa_RRRR_MM.pdf'"}), 400

    session = Session()
    try:
        start_date = datetime(year, month, 1).date()
        end_date = (start_date.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)

        session.query(Shift).filter(Shift.shift_date.between(start_date, end_date)).delete(synchronize_session=False)

        with pdfplumber.open(file) as pdf:
            table = pdf.pages[0].extract_table()
        if not table or len(table) < 2:
            return jsonify({"error": "Nie można znaleźć tabeli w PDF"}), 400

        header, employee_rows = table[0], table[1:]
        users_map = {user.full_name: user.id for user in session.query(User).all()}

        for row in employee_rows:
            if not row or not row[0]: continue
            employee_name, user_id = row[0].strip(), users_map.get(row[0].strip())
            if not user_id:
                print(f"[WARN] Użytkownik '{employee_name}' nie znaleziony. Pomijam.")
                continue

            for day_str, shift_code in zip(header[1:], row[1:]):
                if not day_str or not shift_code: continue
                try:
                    day = int(float(day_str.split('\n')[0].strip().replace('.', '')))
                    date_obj = date(year, month, day)
                    code = str(shift_code).strip().upper()
                    hours = SHIFT_HOURS.get(code, 0.0)
                    session.add(Shift(user_id=user_id, shift_date=date_obj, shift_code=code, hours=hours))
                except (ValueError, TypeError, IndexError):
                    continue
        
        session.commit()
        return jsonify({"msg": "Grafik został wgrany pomyślnie"}), 200
    except Exception as e:
        session.rollback()
        app.logger.error(f"Error during PDF upload: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


# =========================
#   ПУБЛИЧНЫЕ ЭНДПОИНТЫ
# =========================
@app.route('/schedule/day/<string:date_str>', methods=['GET'])
@jwt_required()
def get_day_schedule(date_str):
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Nieprawidłowy format daty. Użyj RRRR-MM-DD"}), 400

    session = Session()
    try:
        shifts = session.query(Shift).join(User).filter(Shift.shift_date == date_obj).all()
        result = [
            {"employee_name": shift.user.full_name, "shift_code": shift.shift_code, "hours": shift.hours}
            for shift in shifts
        ]
        return jsonify(result)
    finally:
        session.close()

@app.route('/me/shifts', methods=['GET'])
@jwt_required()
def me_shifts():
    uid = int(get_jwt_identity())
    session = Session()
    try:
        shifts = session.query(Shift).filter(Shift.user_id == uid).order_by(Shift.shift_date.asc()).all()
        return jsonify([s.to_dict() for s in shifts])
    finally:
        session.close()

# ... (Здесь будут все эндпоинты для обмена сменами, которые мы уже писали)
# Я скопирую их из нашего предыдущего полного файла

# =========================
#  ОБМЕНЫ СМЕНАМИ (SWAPS)
# =========================
# ... (весь код для /swaps, /swaps/incoming, /swaps/outgoing, /accept, /decline, /cancel)

# =========================
#  ОСНОВНОЙ ЗАПУСК
# =========================
if __name__ == '__main__':
    try:
        Base.metadata.create_all(engine)
        print("!!! Successfully connected to the database and ensured tables exist.")
    except Exception as e:
        print(f"!!! FAILED to connect to the database. Error: {e}")
        exit(1)
    
    # Используем порт из окружения для Render, или 5000 по умолчанию
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False) # Debug=False для продакшена
