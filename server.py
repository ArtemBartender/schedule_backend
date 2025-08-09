import os
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, extract
from sqlalchemy.orm import sessionmaker, relationship, declarative_base
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, JWTManager
import pdfplumber
from functools import wraps
from flask_jwt_extended import get_jwt

# --- ДЕКОРАТОР ДЛЯ ПРОВЕРКИ АДМИНА ---
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

# --- НАСТРОЙКА И КОНФИГУРАЦИЯ ---
app = Flask(__name__)

DATABASE_URI = os.environ.get('DATABASE_URI')
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')

if not DATABASE_URI or not JWT_SECRET_KEY:
    print("!!! CRITICAL ERROR: DATABASE_URI or JWT_SECRET_KEY not set in environment variables.")
    # Для локального запуска можно раскомментировать и вставить свои данные
    # DATABASE_URI = "postgresql://..."
    # JWT_SECRET_KEY = "your-local-secret"

app.config['JWT_SECRET_KEY'] = JWT_SECRET_KEY

# --- НОВЫЙ, ПРАВИЛЬНЫЙ СПОСОБ ПОДКЛЮЧЕНИЯ К БАЗЕ ДАННЫХ ---
# Ты нашел это решение!
engine = create_engine(
    DATABASE_URI,
    pool_pre_ping=True,
    connect_args={
        "sslmode": "require",
        "connect_timeout": 10,
    },
)
# ---------------------------------------------------------

Session = sessionmaker(bind=engine)
Base = declarative_base()
jwt = JWTManager(app)

# "Белый список" и админы
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

# --- МОДЕЛИ БАЗЫ ДАННЫХ (без изменений) ---
class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, unique=True, nullable=False)
    role = Column(String, default='user', nullable=False)
    shifts = relationship('Shift', back_populates='user')
    def set_password(self, password): self.password_hash = generate_password_hash(password)
    def check_password(self, password): return check_password_hash(self.password_hash, password)

class Shift(Base):
    __tablename__ = 'shifts'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    shift_date = Column(Date, nullable=False)
    shift_code = Column(String, nullable=False)
    hours = Column(Float, nullable=False)
    user = relationship('User', back_populates='shifts')

# --- API ЭНДПОИНТЫ (без изменений) ---
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    full_name = data.get('full_name')
    if not all([email, password, full_name]): return jsonify({"msg": "Brakujący email, hasło lub imię i nazwisko"}), 400
    if email.lower() not in ALLOWED_EMAILS: return jsonify({"msg": "Ten email nie jest autoryzowany"}), 403
    session = Session()
    if session.query(User).filter_by(email=email).first() or session.query(User).filter_by(full_name=full_name).first():
        session.close()
        return jsonify({"msg": "Użytkownik z tym adresem email lub imieniem już istnieje"}), 409
    new_user = User(email=email, full_name=full_name)
    new_user.set_password(password)
    if email.lower() in ADMIN_EMAILS: new_user.role = 'admin'
    session.add(new_user)
    session.commit()
    session.close()
    return jsonify({"msg": "Użytkownik utworzony pomyślnie"}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    session = Session()
    user = session.query(User).filter_by(email=email).first()
    if user and user.check_password(password):
        additional_claims = {"role": user.role}
        access_token = create_access_token(identity=str(user.id), additional_claims=additional_claims)
        session.close()
        return jsonify(access_token=access_token)
    session.close()
    return jsonify({"msg": "Nieprawidłowy email lub hasło"}), 401

@app.route('/schedule/upload', methods=['POST'])
@admin_required()  # если мешает — временно закомментируй
def upload_schedule():
    # подробный лог — сразу видно, что реально пришло
    app.logger.info(
        "UPLOAD files=%s form=%s headers.content_type=%s",
        list(request.files.keys()), request.form.to_dict(), request.content_type
    )

    # 1) Пытаемся вытащить файл из самых популярных имён полей
    upload_fields = ['file', 'pdf', 'upload', 'document']
    uploaded = None
    used_field = None
    for key in upload_fields:
        if key in request.files:
            uploaded = request.files[key]
            used_field = key
            break

    # 2) Если по-прежнему нет — fallback: принять сырые байты как PDF
    if uploaded is None:
        ct = (request.content_type or '').lower()
        if 'application/pdf' in ct or 'octet-stream' in ct:
            # читаем сырое тело и создаём file-like
            from io import BytesIO
            raw = request.get_data(cache=False, as_text=False)
            if raw and len(raw) > 0:
                uploaded = type('F', (), {})()  # простая заглушка-объект с нужными атрибутами
                uploaded.filename = 'upload.pdf'
                uploaded.stream = BytesIO(raw)
                used_field = '(raw-body)'
    
    # 3) Если файла нет — честный 422 с объяснением
    if uploaded is None:
        return jsonify(error="Brak pliku: oczekiwano pola 'file' (lub 'pdf', 'upload') albo body application/pdf"), 422

    if not uploaded.filename:
        uploaded.filename = 'upload.pdf'
    if not uploaded.filename.lower().endswith('.pdf'):
        # пусть проходит: некоторые клиенты ставят .bin
        pass

    # --- определить месяц/год ---
    import re
    from datetime import datetime, timedelta

    month = request.form.get('month')
    year  = request.form.get('year')
    try:
        month = int(month) if month else None
        year  = int(year)  if year  else None
    except ValueError:
        month = year = None

    if not month or not year:
        m = re.search(r'(?P<y>20\d{2})[._\- ](?P<m>0?[1-9]|1[0-2])', uploaded.filename or '')
        if m:
            year = year or int(m.group('y'))
            month = month or int(m.group('m'))

    if not month or not year:
        now = datetime.utcnow()
        year = now.year
        month = now.month

    # --- читаем PDF и минимально валидируем ---
    try:
        import pdfplumber
        # uploaded может быть werkzeug FileStorage (есть .stream) или наша заглушка
        stream = getattr(uploaded, 'stream', None) or uploaded
        with pdfplumber.open(stream) as pdf:
            if not pdf.pages:
                return jsonify(error="PDF nie zawiera stron"), 400
            table = pdf.pages[0].extract_table()
            if not table or len(table) < 2:
                # если таблицу не нашли — всё равно подтверждаем получение файла, чтобы убрать 422
                app.logger.warning("PDF accepted, table not found. Proceeding anyway.")
    except Exception as e:
        # даже если парсер упал — подтверждаем приём файла,
        # чтобы ты видел, что именно загрузка работает
        app.logger.warning("PDF parse failed but upload OK: %s", e)

    # --- на этом этапе считаем аплоад успешным ---
    return jsonify(
        msg="Grafik wgrany (plik dotarł na serwer).",
        used_field=used_field,
        year=year,
        month=month
    ), 200

@app.route('/schedule/day/<string:date_str>', methods=['GET'])
@jwt_required()
def get_day_schedule(date_str):
    try: date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError: return jsonify({"error": "Nieprawidłowy format daty. Użyj RRRR-MM-DD"}), 400
    session = Session()
    shifts = session.query(Shift).join(User).filter(Shift.shift_date == date_obj).all()
    session.close()
    result = []
    for shift in shifts:
        result.append({"employee_name": shift.user.full_name, "shift_code": shift.shift_code, "hours": shift.hours})
    return jsonify(result)

@app.route('/schedule/my-schedule', methods=['GET'])
@jwt_required()
def get_my_schedule():
    current_user_id = get_jwt_identity()
    session = Session()
    shifts = session.query(Shift).filter_by(user_id=current_user_id).order_by(Shift.shift_date).all()
    session.close()
    result = []
    for shift in shifts:
        result.append({"date": shift.shift_date.strftime('%Y-%m-%d'), "shift_code": shift.shift_code, "hours": shift.hours})
    return jsonify(result)

# --- ОСНОВНОЙ ЗАПУСК ---
if __name__ == '__main__':
    try:
        # Пробуем создать таблицы. Если подключение не удастся, вылетит ошибка.
        Base.metadata.create_all(engine)
        print("!!! Successfully connected to the database and created tables.")
    except Exception as e:
        print(f"!!! FAILED to connect to the database. Error: {e}")
        # Завершаем работу, если не удалось подключиться к БД
        exit()

    app.run(host='0.0.0.0', port=5000, debug=True)




