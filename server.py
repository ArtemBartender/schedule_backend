import os
from datetime import datetime, timedelta, date
from functools import wraps

from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Date, DateTime, Boolean,
    ForeignKey
)
from sqlalchemy.orm import sessionmaker, relationship, declarative_base

from flask_jwt_extended import (
    create_access_token, jwt_required, get_jwt_identity, JWTManager, get_jwt
)

import pdfplumber


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
#  НАСТРОЙКА ПРИЛОЖЕНИЯ
# =========================
app = Flask(__name__)

# Render/Supabase: переменные должны быть выставлены в окружении
DATABASE_URI = os.environ.get('DATABASE_URI')
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')

if not DATABASE_URI or not JWT_SECRET_KEY:
    print("!!! CRITICAL ERROR: DATABASE_URI or JWT_SECRET_KEY not set in environment variables.")
    # локально можно раскомментировать и вставить свои значения
    # DATABASE_URI = "postgresql://USER:PASSWORD@HOST:PORT/DBNAME"
    # JWT_SECRET_KEY = "dev-secret"
from datetime import timedelta

app.config['JWT_SECRET_KEY'] = JWT_SECRET_KEY
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=14)


# Правильное подключение к Postgres в облаке (Supabase/Render)
engine = create_engine(
    DATABASE_URI,
    pool_pre_ping=True,
    connect_args={
        "sslmode": "require",
        "connect_timeout": 10,
    },
)

Session = sessionmaker(bind=engine)
Base = declarative_base()
jwt = JWTManager(app)

@jwt.unauthorized_loader
def _missing_token(e):
    return jsonify(error="Missing or invalid Authorization header"), 401

@jwt.invalid_token_loader
def _bad_token(e):
    return jsonify(error=str(e)), 401

@jwt.expired_token_loader
def _expired(jwt_header, jwt_payload):
    return jsonify(error="Token expired"), 401


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

# Коды смен -> часы (по твоей логике)
SHIFT_HOURS = {
  "1": 9.5, "1/B": 9.5, "2": 9.5, "2/B": 9.5,
  "W": 0.0, "O": 0.0, "CH": 0.0,
  "X": 0.0,   # часто встречается в PDF
  "B": 9.5,   # одиночная "B" (распад 2/B)
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

    # связи
    shifts = relationship('Shift', back_populates='user', cascade="all, delete-orphan")
    outgoing_swaps = relationship('SwapRequest', foreign_keys='SwapRequest.from_user_id', back_populates='from_user')
    incoming_swaps = relationship('SwapRequest', foreign_keys='SwapRequest.to_user_id', back_populates='to_user')

    # утилиты
    def set_password(self, password): self.password_hash = generate_password_hash(password)
    def check_password(self, password): return check_password_hash(self.password_hash, password)


class Shift(Base):
    __tablename__ = 'shifts'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    shift_date = Column(Date, nullable=False)
    shift_code = Column(String, nullable=False)
    hours = Column(Float, nullable=False)

    # Новые поля для подсветки координаторов (будем заполнять при парсинге PDF)
    is_coordinator = Column(Boolean, default=False, nullable=False)
    color_hex = Column(String, nullable=True)  # ожидаем формат "#RRGGBB"

    user = relationship('User', back_populates='shifts')

    def to_dict(self):
        """Удобный формат для фронта."""
        return {
            "id": self.id,
            "date": self.shift_date.strftime('%Y-%m-%d'),
            "shift_code": self.shift_code,
            "hours": self.hours,
            "isCoordinator": bool(self.is_coordinator),
            "colorHex": self.color_hex
        }


class SwapRequest(Base):
    """
    Таблица запросов на обмен сменами.
    """
    __tablename__ = 'swap_requests'

    id = Column(Integer, primary_key=True)

    from_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    to_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    from_shift_id = Column(Integer, ForeignKey('shifts.id', ondelete='CASCADE'), nullable=False)
    to_shift_id = Column(Integer, ForeignKey('shifts.id', ondelete='SET NULL'), nullable=True)

    status = Column(String, default='pending', nullable=False)  # pending / accepted / declined / cancelled

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    from_user = relationship('User', foreign_keys=[from_user_id], back_populates='outgoing_swaps')
    to_user = relationship('User', foreign_keys=[to_user_id], back_populates='incoming_swaps')
    from_shift = relationship('Shift', foreign_keys=[from_shift_id])
    to_shift = relationship('Shift', foreign_keys=[to_shift_id])

    def to_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "from_user": self.from_user.full_name if self.from_user else None,
            "to_user": self.to_user.full_name if self.to_user else None,
            "from_shift": self.from_shift.to_dict() if self.from_shift else None,
            "to_shift": self.to_shift.to_dict() if self.to_shift else None
        }


# =========================
#        АВТОРИЗАЦИЯ
# =========================
@app.route('/register', methods=['POST'])
def register():
    """
    Регистрация доступна только по белому списку email.
    Роли: user/admin (назначается по ADMIN_EMAILS).
    """
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
        if session.query(User).filter_by(email=email).first() or session.query(User).filter_by(full_name=full_name).first():
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
    """
    Возвращает JWT с claim `role`.
    """
    data = request.get_json()
    email = (data.get('email') or "").strip().lower()
    password = data.get('password')

    session = Session()
    try:
        user = session.query(User).filter_by(email=email).first()
        if user and user.check_password(password):
            additional_claims = {"role": user.role}
            token = create_access_token(identity=str(user.id), additional_claims=additional_claims)
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
    """
    Ожидается имя файла: *_RRRR_MM.pdf
    - чистим смены за месяц
    - парсим все страницы по линиям (pdfplumber.extract_tables)
    - нормализуем шапку (дни 1..31) и строки сотрудников
    - игнорируем служебные строки (Nazwisko i imię / PLAN / BRAKI)
    """
    import re  # локальный импорт, чтобы не трогать верх файла

    # --- Настройки детектора таблиц (по линиям) ---
    TABLE_SETTINGS = {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "snap_tolerance": 3,
        "join_tolerance": 3,
        "edge_min_length": 20,
        "min_words_vertical": 1,
        "min_words_horizontal": 1,
        "keep_blank_chars": False,
        "text_tolerance": 2,
    }

    def _norm_text(v) -> str:
        s = "" if v is None else str(v).replace("\n", " ").replace("\r", " ")
        return re.sub(r"\s+", " ", s).strip()

    def _parse_day_header(cell) -> int | None:
        """В шапке могут быть артефакты типа '1\\n,0\\n8'. Достаём первое число 1..31."""
        if cell is None:
            return None
        digits = re.findall(r"\d+", str(cell))
        if not digits:
            return None
        try:
            d = int(digits[0])
            return d if 1 <= d <= 31 else None
        except ValueError:
            return None

    def _norm_code(v) -> str:
        """Код смены -> '1','2','1/B','2/B','W','O','CH','X','B' и т.п."""
        s = str(v or "").upper()
        s = s.replace("\n", "").replace(" ", "").replace(".", "").replace(",", "")
        # частые варианты мусора мы отсекаем позже
        # X считаем выходным (0 часов): сведём к W, чтобы не множить коды
        if s == "X":
            return "W"
        return s

    def _is_meta_row(name_cell: str) -> bool:
        n = (name_cell or "").strip().lower()
        return (
            not n
            or n.startswith("nazwisko")  # "Nazwisko i imię"
            or n.startswith("plan")      # PLAN
            or n.startswith("braki")     # BRAKI
        )

    # --- Проверяем наличие файла ---
    if 'file' not in request.files:
        return jsonify({"error": "Brak pliku"}), 400

    file = request.files['file']
    if not file or not file.filename:
        return jsonify({"error": "Nie wybrano pliku"}), 400

    # --- Год/месяц из имени файла ---
    try:
        m = re.search(r'(\d{4})_(\d{1,2})\.pdf$', file.filename, re.IGNORECASE)
        if not m:
            raise ValueError("bad filename")
        year = int(m.group(1))
        month = int(m.group(2))
        if not (1 <= month <= 12):
            raise ValueError("bad month")
    except Exception:
        return jsonify({"error": "Nieprawidłowy format nazwy pliku. Oczekiwano 'nazwa_RRRR_MM.pdf'"}), 400

    session = Session()
    try:
        # --- Диапазон месяца ---
        start_date = datetime(year, month, 1).date()
        end_date = (start_date.replace(year=year + 1, month=1) - timedelta(days=1)) if month == 12 \
                   else (start_date.replace(month=month + 1) - timedelta(days=1))

        # --- Чистим существующие смены за месяц (перезалив) ---
        session.query(Shift).filter(
            Shift.shift_date >= start_date,
            Shift.shift_date <= end_date
        ).delete(synchronize_session=False)

        # --- Кеш пользователей по ФИО ---
        users_map = {u.full_name.strip(): u.id for u in session.query(User).all()}

        rows_added = 0
        pages_scanned = 0

        # --- Парсим все страницы (бывает, что таблица не влезает на одну) ---
        with pdfplumber.open(file) as pdf:
            for page in pdf.pages:
                pages_scanned += 1
                tables = page.extract_tables(TABLE_SETTINGS) or []
                if not tables:
                    continue

                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    # 1) найдём строку-шапку с днями (обычно одна из первых)
                    header_row = None
                    for r in table[:3]:
                        if not r:
                            continue
                        nums = [_parse_day_header(c) for c in r]
                        if sum(1 for x in nums[1:] if x) >= 10:  # достаточно много валидных дней
                            header_row = r
                            break
                    if header_row is None:
                        header_row = table[0]

                    # вектор дней по колонкам (index -> day or None)
                    day_by_col: list[int | None] = []
                    for idx, cell in enumerate(header_row):
                        day_by_col.append(None if idx == 0 else _parse_day_header(cell))

                    # 2) строки сотрудников
                    for r in table[1:]:
                        if not r:
                            continue
                        name_raw = _norm_text(r[0])
                        if _is_meta_row(name_raw):
                            continue

                        user_id = users_map.get(name_raw)
                        if not user_id:
                            print(f"[UPLOAD] Użytkownik '{name_raw}' nie znaleziony — pomijam.")
                            continue

                        # 3) по столбцам-дням
                        for col_idx in range(1, min(len(r), len(day_by_col))):
                            day = day_by_col[col_idx]
                            if not day:
                                continue  # это не день

                            code = _norm_code(r[col_idx])
                            if not code:
                                continue

                            # отсеиваем явный мусор
                            allowed = {"1", "2", "1/B", "2/B", "W", "O", "CH", "B"}
                            if code not in allowed:
                                continue

                            date_obj = datetime(year, month, day).date()

                            # часы: берём из SHIFT_HOURS; если кода нет (например 'B') — падать нельзя
                            hours = SHIFT_HOURS.get(code)
                            if hours is None:
                                # безопасный дефолт: считаем это рабочей сменой полной длины
                                hours = SHIFT_HOURS.get('2/B', 9.5)

                            session.add(Shift(
                                user_id=user_id,
                                shift_date=date_obj,
                                shift_code=code,   # сохраняем как в PDF (после нормализации)
                                hours=hours,
                                is_coordinator=False,
                                color_hex=None
                            ))
                            rows_added += 1

        session.commit()
        return jsonify({
            "msg": "Grafik został wgrany i przetworzony pomyślnie",
            "rows_added": rows_added,
            "pages_scanned": pages_scanned
        }), 200

    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


# =========================
#     ПУБЛИЧНЫЕ ЭНДПОИНТЫ
# =========================
@app.route('/schedule/day/<string:date_str>', methods=['GET'])
@jwt_required()
def get_day_schedule(date_str):
    """
    Возвращает список сотрудников на день.
    (старый контракт — не меняем, чтобы фронт не сломать)
    """
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Nieprawidłowy format daty. Użyj RRRR-MM-DD"}), 400

    session = Session()
    try:
        shifts = session.query(Shift).join(User).filter(Shift.shift_date == date_obj).all()
        result = [
            {
                "employee_name": shift.user.full_name,
                "shift_code": shift.shift_code,
                "hours": shift.hours
            }
            for shift in shifts
        ]
        return jsonify(result)
    finally:
        session.close()


@app.route('/schedule/my-schedule', methods=['GET'])
@jwt_required()
def get_my_schedule():
    """
    Старый эндпоинт для личного графика без доп. полей.
    Оставляем для обратной совместимости.
    """
    current_user_id = get_jwt_identity()
    session = Session()
    try:
        shifts = session.query(Shift).filter_by(user_id=current_user_id).order_by(Shift.shift_date).all()
        result = [
            {
                "date": s.shift_date.strftime('%Y-%m-%d'),
                "shift_code": s.shift_code,
                "hours": s.hours
            }
            for s in shifts
        ]
        return jsonify(result)
    finally:
        session.close()


# =========================
#     НОВЫЙ ЭНДПОИНТ V1.1
# =========================
@app.route('/me/shifts', methods=['GET'])
@jwt_required()
def me_shifts():
    """
    Современный эндпоинт для экрана "Moje zmiany".
    Поддерживает фильтры:
      - ?from=YYYY-MM-DD
      - ?to=YYYY-MM-DD

    Возвращает список смен с полями isCoordinator/colorHex.
    """
    uid = int(get_jwt_identity())
    d_from = request.args.get('from')
    d_to = request.args.get('to')

    try:
        date_from = datetime.strptime(d_from, '%Y-%m-%d').date() if d_from else None
        date_to = datetime.strptime(d_to, '%Y-%m-%d').date() if d_to else None
    except ValueError:
        return jsonify({"error": "Parametry 'from'/'to' muszą być w formacie RRRR-MM-DD"}), 400

    session = Session()
    try:
        q = session.query(Shift).filter(Shift.user_id == uid)
        if date_from:
            q = q.filter(Shift.shift_date >= date_from)
        if date_to:
            q = q.filter(Shift.shift_date <= date_to)

        rows = q.order_by(Shift.shift_date.asc()).all()
        return jsonify([s.to_dict() for s in rows])
    finally:
        session.close()


# ========================================================
#                ОБМЕНЫ СМЕНАМИ (SWAPS)
# ========================================================

def _shift_min_dict(s: Shift):
    return s.to_dict() if s else None


def _swap_to_dict(swap: 'SwapRequest'):
    return {
        "id": swap.id,
        "status": swap.status,
        "created_at": swap.created_at.isoformat(),
        "updated_at": swap.updated_at.isoformat(),
        "from_user": swap.from_user.full_name if swap.from_user else None,
        "to_user": swap.to_user.full_name if swap.to_user else None,
        "from_shift": _shift_min_dict(swap.from_shift),
        "to_shift": _shift_min_dict(swap.to_shift),
    }


def _validate_no_conflict(session, user_id: int, target_date: date, exclude_shift_ids=None) -> bool:
    """
    Проверяем, что у пользователя НЕТ другой смены в этот же день.
    exclude_shift_ids — список id смен, которые игнорируем (например, сами участники обмена).
    """
    exclude_shift_ids = set(exclude_shift_ids or [])
    q = session.query(Shift).filter(
        Shift.user_id == user_id,
        Shift.shift_date == target_date
    )
    if exclude_shift_ids:
        q = q.filter(~Shift.id.in_(exclude_shift_ids))
    return session.query(q.exists()).scalar() is False


@app.route('/swaps', methods=['POST'])
@jwt_required()
def create_swap():
    """
    Создать запрос обмена.
    Тело:
      {
        "from_shift_id": 123,            # смена инициатора (обяз.)
        "to_shift_id": 456 | null        # смена получателя (если null — передача смены)
      }
    Владелец from_shift_id должен быть текущим пользователем.
    """
    uid = int(get_jwt_identity())
    data = request.get_json() or {}
    from_shift_id = data.get('from_shift_id')
    to_shift_id = data.get('to_shift_id')  # может быть None — односторонняя передача

    if not from_shift_id:
        return jsonify({"error": "from_shift_id jest wymagane."}), 400

    session = Session()
    try:
        from_shift = session.query(Shift).filter_by(id=from_shift_id, user_id=uid).first()
        if not from_shift:
            return jsonify({"error": "Ta zmiana nie należy do Ciebie."}), 403

        to_shift = None
        to_user_id = None

        if to_shift_id is not None:
            to_shift = session.query(Shift).filter_by(id=to_shift_id).first()
            if not to_shift:
                return jsonify({"error": "Docelowa zmiana nie istnieje."}), 404
            if to_shift.user_id == uid:
                return jsonify({"error": "Nie możesz wymienić się sam ze sobą."}), 409
            to_user_id = to_shift.user_id
        else:
            # Если передача смены — нужно явно указать получателя (в этом варианте — из поля to_user_id)
            to_user_id = data.get('to_user_id')
            if not to_user_id:
                return jsonify({"error": "Podaj to_user_id dla przekazania zmiany."}), 400
            if to_user_id == uid:
                return jsonify({"error": "Nie możesz przekazać zmiany samemu sobie."}), 409

        # Создаём своп
        swap = SwapRequest(
            from_user_id=uid,
            to_user_id=to_user_id,
            from_shift_id=from_shift.id,
            to_shift_id=to_shift.id if to_shift else None,
            status='pending'
        )
        session.add(swap)
        session.commit()
        return jsonify(_swap_to_dict(swap)), 201

    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


@app.route('/swaps/incoming', methods=['GET'])
@jwt_required()
def swaps_incoming():
    uid = int(get_jwt_identity())
    session = Session()
    try:
        items = session.query(SwapRequest).filter_by(to_user_id=uid).order_by(SwapRequest.created_at.desc()).all()
        return jsonify([_swap_to_dict(s) for s in items])
    finally:
        session.close()


@app.route('/swaps/outgoing', methods=['GET'])
@jwt_required()
def swaps_outgoing():
    uid = int(get_jwt_identity())
    session = Session()
    try:
        items = session.query(SwapRequest).filter_by(from_user_id=uid).order_by(SwapRequest.created_at.desc()).all()
        return jsonify([_swap_to_dict(s) for s in items])
    finally:
        session.close()


def _perform_accept(session, swap: SwapRequest, actor_user_id: int):
    """
    Атомарно принять обмен:
    - Проверка: pending и actor == to_user
    - Проверка принадлежности смен (на случай изменений)
    - Проверка конфликтов по датам у обеих сторон
    - Перенос владельцев смен (или reassignment при передаче)
    """
    if swap.status != 'pending':
        return {"error": "Tę zamianę już przetworzono."}, 409

    if swap.to_user_id != actor_user_id:
        return {"error": "Brak uprawnień do akceptacji tej zamiany."}, 403

    from_shift = session.query(Shift).filter_by(id=swap.from_shift_id).first()
    to_shift = session.query(Shift).filter_by(id=swap.to_shift_id).first() if swap.to_shift_id else None

    if not from_shift or (swap.to_shift_id and not to_shift):
        return {"error": "Jedna z zmian nie istnieje."}, 404

    if from_shift.user_id != swap.from_user_id:
        return {"error": "Zmiana nadawcy już nie należy do niego."}, 409
    if to_shift and to_shift.user_id != swap.to_user_id:
        return {"error": "Twoja zmiana już nie należy do Ciebie."}, 409

    # Проверка конфликтов:
    # 1) Если это обмен 1:1 — проверяем, что после обмена у обоих нет второй смены в тот же день.
    # 2) Если это передача — проверяем только у получателя в дату from_shift.
    if to_shift:
        # Конфликт у инициатора в дату to_shift
        if not _validate_no_conflict(session, swap.from_user_id, to_shift.shift_date,
                                     exclude_shift_ids=[from_shift.id, to_shift.id]):
            return {"error": "Masz już zmianę lub konflikt w dniu docelowej zmiany."}, 409
        # Конфликт у получателя в дату from_shift
        if not _validate_no_conflict(session, swap.to_user_id, from_shift.shift_date,
                                     exclude_shift_ids=[from_shift.id, to_shift.id]):
            return {"error": "Odbiorca ma już zmianę lub konflikt w dniu Twojej zmiany."}, 409

        # Всё чисто — делаем обмен владельцев
        orig_from_user = from_shift.user_id
        orig_to_user = to_shift.user_id
        from_shift.user_id = orig_to_user
        to_shift.user_id = orig_from_user
        session.add_all([from_shift, to_shift])
    else:
        # Передача: просто назначаем from_shift получателю
        if not _validate_no_conflict(session, swap.to_user_id, from_shift.shift_date,
                                     exclude_shift_ids=[from_shift.id]):
            return {"error": "Odbiorca ma już zmianę lub konflikt w tym dniu."}, 409
        from_shift.user_id = swap.to_user_id
        session.add(from_shift)

    swap.status = 'accepted'
    swap.updated_at = datetime.utcnow()
    session.add(swap)

    return {"status": "accepted", "swap": _swap_to_dict(swap)}, 200


@app.route('/swaps/<int:swap_id>/accept', methods=['POST'])
@jwt_required()
def swap_accept(swap_id: int):
    uid = int(get_jwt_identity())
    session = Session()
    try:
        swap = session.query(SwapRequest).filter_by(id=swap_id).first()
        if not swap:
            return jsonify({"error": "Swap nie istnieje."}), 404

        # Транзакция
        try:
            # begin_nested на случай, если render/postgres под капотом требует SAVEPOINT
            with session.begin():
                payload, code = _perform_accept(session, swap, uid)
                if code != 200:
                    session.rollback()
                    return jsonify(payload), code
            session.commit()
        except Exception as e:
            session.rollback()
            return jsonify({"error": str(e)}), 500

        return jsonify(payload), code
    finally:
        session.close()


@app.route('/swaps/<int:swap_id>/decline', methods=['POST'])
@jwt_required()
def swap_decline(swap_id: int):
    uid = int(get_jwt_identity())
    session = Session()
    try:
        swap = session.query(SwapRequest).filter_by(id=swap_id).first()
        if not swap:
            return jsonify({"error": "Swap nie istnieje."}), 404
        if swap.to_user_id != uid:
            return jsonify({"error": "To nie jest Twoja przychodząca zamiana."}), 403
        if swap.status != 'pending':
            return jsonify({"error": "Tę zamianę już przetworzono."}), 409

        swap.status = 'declined'
        swap.updated_at = datetime.utcnow()
        session.add(swap)
        session.commit()

        return jsonify({"status": "declined", "swap": _swap_to_dict(swap)}), 200
    finally:
        session.close()


@app.route('/swaps/<int:swap_id>/cancel', methods=['POST'])
@jwt_required()
def swap_cancel(swap_id: int):
    uid = int(get_jwt_identity())
    session = Session()
    try:
        swap = session.query(SwapRequest).filter_by(id=swap_id).first()
        if not swap:
            return jsonify({"error": "Swap nie istnieje."}), 404
        if swap.from_user_id != uid:
            return jsonify({"error": "To nie jest Twoja wysłana zamiana."}), 403
        if swap.status != 'pending':
            return jsonify({"error": "Tę zamianę już przetworzono."}), 409

        swap.status = 'cancelled'
        swap.updated_at = datetime.utcnow()
        session.add(swap)
        session.commit()

        return jsonify({"status": "cancelled", "swap": _swap_to_dict(swap)}), 200
    finally:
        session.close()


# =========================
#         ЗАПУСК
# =========================
if __name__ == '__main__':
    try:
        # create_all СОЗДАЁТ таблицы, но не мигрирует схему.
        Base.metadata.create_all(engine)
        print("!!! Successfully connected to the database and ensured tables exist.")
    except Exception as e:
        print(f"!!! FAILED to connect to the database. Error: {e}")
        exit(1)

    app.run(host='0.0.0.0', port=5000, debug=True)



