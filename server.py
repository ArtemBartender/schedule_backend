import os
from datetime import datetime
from flask import Flask, request, jsonify
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import sessionmaker, relationship, declarative_base
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, JWTManager
import pdfplumber


from functools import wraps
from flask_jwt_extended import get_jwt

def admin_required():
    def wrapper(fn):
        @wraps(fn)
        @jwt_required()
        def decorator(*args, **kwargs):
            claims = get_jwt()
            if claims.get('role') == 'admin':
                return fn(*args, **kwargs)
            else:
                return jsonify(msg="Admins only!"), 403
        return decorator
    return wrapper
# --- НАСТРОЙКА И КОНФИГУРАЦИЯ ---

app = Flask(__name__)

DATABASE_URI = os.environ.get('DATABASE_URI')
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY')
# !!! ВАЖНО: Замените на любой сложный секретный ключ !!!
app.config['JWT_SECRET_KEY'] = '0503010365Danon!' 

# Настройка базы данных
engine = create_engine(DATABASE_URI)
Session = sessionmaker(bind=engine)
Base = declarative_base()
jwt = JWTManager(app)

# "Белый список" email для регистрации. Добавьте сюда email всех ваших коллег.
# Регистрация будет разрешена только для этих адресов.
ALLOWED_EMAILS = {
    "r.czajka@lot.pl",
    "k.koszut-gawryszak@lot.pl",
    "a.daniel@lot.pl",
    "m.kaczmarski@lot.pl",
    "k.levchenko@lot.pl",
    "p.tomaszewska@lot.pl",
    "a.palczewska@lot.pl",
    "j.cioch@lot.pl",
    "t.rudiuk@lot.pl",
    "m.rybchynchuk@lot.pl",
    "m.romanova@lot.pl",
    "r.vozniak@lot.pl",
    "a.bilenko@lot.pl",
    "a.makiunychuk@lot.pl",
    "m.cieplucha@lot.pl",
    "i.frejnik@lot.pl",
    "p.golebiowska@lot.pl",
    "a.tkachenko@lot.pl",
    "y.hizhetska@lot.pl",
    "s.burghardt@lot.pl",
    "a.yakymenko@lot.pl",
    "a.mazur@lot.pl",
    "k.iskova@lot.pl",
    "m.titarenko@lot.pl",
    "v.zaitseva@lot.pl",
    "j.krzymieniewski@lot.pl",
    "m.fraczyk@lot.pl",
    "m.lejza@lot.pl",
    "l.sulkowski@lot.pl",
    "v.nadiuk@lot.pl",
    "y.makivnychuk@lot.pl",
    "n.godzisz@lot.pl",
    "d.shapoval@lot.pl",
    "d.solop@lot.pl",
    "a.kupczyk@lot.pl",
    "j.wlodarczyk@lot.pl",
    "a.buska@lot.pl",
    "w.utko@lot.pl",
    "o.grabowska@lot.pl",
    "a.jankowska@lot.pl",
    "w.skorupska@lot.pl",
    "p.paskudzka@lot.pl",
    "m.zukowska@lot.pl",
    "s.paczkowska@lot.pl",
    "m.demko@lot.pl",
    "z.kornacka@lot.pl",
    "r.nowacka@lot.pl",
    "k.janikiewicz@lot.pl"
}

ADMIN_EMAILS = {
    "r.czajka@lot.pl",
    "k.koszut-gawryszak@lot.pl",
    "m.kaczmarski@lot.pl",
    "a.bilenko@lot.pl",
}

# Словарь для определения часов по коду смены.
SHIFT_HOURS = {
    "1": 9.5, "1/B": 9.5,
    "2": 9.5, "2/B": 9.5,
}

# --- МОДЕЛИ БАЗЫ ДАННЫХ (описание таблиц) ---

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, unique=True, nullable=False)
    role = Column(String, default='user', nullable=False) # <-- ДОБАВЬ ЭТУ СТРОКУ
    shifts = relationship('Shift', back_populates='user')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Shift(Base):
    __tablename__ = 'shifts'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    shift_date = Column(Date, nullable=False)
    shift_code = Column(String, nullable=False)
    hours = Column(Float, nullable=False)
    user = relationship('User', back_populates='shifts')

# --- API ЭНДПОИНТЫ (адреса, к которым будет обращаться приложение) ---

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    full_name = data.get('full_name')

    if not all([email, password, full_name]):
        return jsonify({"msg": "Missing email, password, or full_name"}), 400

    if email not in ALLOWED_EMAILS:
        return jsonify({"msg": "Email not allowed"}), 403

    session = Session()
    if session.query(User).filter_by(email=email).first() or \
       session.query(User).filter_by(full_name=full_name).first():
        session.close()
        return jsonify({"msg": "User with this email or name already exists"}), 409
    if email.lower() in ADMIN_EMAILS:
        new_user.role = 'admin'

    new_user = User(email=email, full_name=full_name)
    new_user.set_password(password)
    session.add(new_user)
    session.commit()
    session.close()
    return jsonify({"msg": "User created successfully"}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    session = Session()
    user = session.query(User).filter_by(email=email).first()
    session.close()

    if user and user.check_password(password):
       additional_claims = {"role": user.role}
       access_token = create_access_token(identity=user.id, additional_claims=additional_claims)
        
        return jsonify(access_token=access_token)
    
    return jsonify({"msg": "Bad email or password"}), 401

@app.route('/schedule/upload', methods=['POST'])
@admin_required() # Этот эндпоинт теперь защищен
def upload_schedule():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    # Предполагаем, что имя файла содержит год и месяц, например "grafik_2025_08.pdf"
    try:
        filename_parts = file.filename.split('_')
        year = int(filename_parts[1])
        month = int(filename_parts[2].split('.')[0])
    except (IndexError, ValueError):
        return jsonify({"error": "Invalid filename format. Expected 'name_YYYY_MM.pdf'"}), 400

    session = Session()
    
    try:
        # Удаляем старые смены за этот месяц, чтобы избежать дубликатов
        session.query(Shift).filter(
            extract('year', Shift.shift_date) == year,
            extract('month', Shift.shift_date) == month
        ).delete(synchronize_session=False)

        with pdfplumber.open(file) as pdf:
            table = pdf.pages[0].extract_table()

        if not table or len(table) < 2:
            return jsonify({"error": "Could not find or parse table in PDF"}), 400
        
        header = table[0]
        employee_rows = table[1:]

        # Получаем всех пользователей из БД, чтобы сопоставить имена
        users_map = {user.full_name: user.id for user in session.query(User).all()}

        for row in employee_rows:
            if not row or not row[0]: continue
            
            employee_name = row[0].strip()
            user_id = users_map.get(employee_name)

            if not user_id:
                print(f"Warning: User '{employee_name}' from PDF not found in database. Skipping.")
                continue

            for day_str, shift_code in zip(header[1:], row[1:]):
                if not day_str or not shift_code: continue
                
                try:
                    day = int(float(day_str.replace('.', '')))
                    date_obj = datetime(year, month, day).date()
                    hours = SHIFT_HOURS.get(shift_code.strip(), 0.0)
                    
                    new_shift = Shift(
                        user_id=user_id,
                        shift_date=date_obj,
                        shift_code=shift_code.strip(),
                        hours=hours
                    )
                    session.add(new_shift)
                except (ValueError, TypeError):
                    continue
        
        session.commit()
        return jsonify({"msg": "Schedule uploaded and processed successfully"}), 200

    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()

@app.route('/schedule/day/<string:date_str>', methods=['GET'])
@jwt_required()
def get_day_schedule(date_str):
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400

    session = Session()
    shifts = session.query(Shift).filter(Shift.shift_date == date_obj).all()
    session.close()

    result = []
    for shift in shifts:
        result.append({
            "employee_name": shift.user.full_name,
            "shift_code": shift.shift_code,
            "hours": shift.hours
        })
    return jsonify(result)

# --- ОСНОВНОЙ ЗАПУСК ---

if __name__ == '__main__':
    # Эта команда создает таблицы в базе данных, если их еще нет
    Base.metadata.create_all(engine)
    app.run(host='0.0.0.0', port=5000, debug=True)
