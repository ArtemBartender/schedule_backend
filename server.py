import os
import io
import logging
from datetime import datetime, timedelta, date
from functools import wraps
from logging.handlers import RotatingFileHandler

from flask import Flask, request, jsonify, send_file, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, DateTime, Boolean, ForeignKey, Text, and_, or_
from sqlalchemy.orm import sessionmaker, relationship, declarative_base
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, JWTManager, get_jwt
from flask_cors import CORS
import pdfplumber
import qrcode
from io import BytesIO
import base64

# =========================
#  НАСТРОЙКА ПРИЛОЖЕНИЯ
# =========================
app = Flask(__name__)

# Настройка CORS
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# Настройка логирования
handler = RotatingFileHandler('app.log', maxBytes=10000, backupCount=3)
handler.setLevel(logging.INFO)
app.logger.addHandler(handler)

# Конфигурация из переменных окружения
DATABASE_URL = os.environ.get('DATABASE_URL')
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')

if not DATABASE_URL or not JWT_SECRET_KEY:
    print("!!! CRITICAL ERROR: DATABASE_URL or JWT_SECRET_KEY not set in environment variables.")
    # Для локальной разработки
    DATABASE_URL = "sqlite:///local.db"
    JWT_SECRET_KEY = "dev-secret-key-change-in-production"

app.config['JWT_SECRET_KEY'] = JWT_SECRET_KEY
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=14)

# Настройка базы данных
engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)
Base = declarative_base()
jwt = JWTManager(app)

# =========================
#  МОДЕЛЬ SWAPREQUEST
# =========================
class SwapRequest(Base):
    __tablename__ = 'swap_requests'
    
    id = Column(Integer, primary_key=True)
    from_user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    to_user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    shift_id = Column(Integer, ForeignKey('shifts.id'), nullable=False)
    status = Column(String(20), default='pending')  # pending, accepted, declined
    created_at = Column(DateTime, default=datetime.utcnow)
    
    from_user = relationship('User', foreign_keys=[from_user_id], backref='outgoing_swaps')
    to_user = relationship('User', foreign_keys=[to_user_id], backref='incoming_swaps')
    shift = relationship('Shift')

# =========================
#  ДОПОЛНИТЕЛЬНЫЕ МОДЕЛИ
# =========================
class Availability(Base):
    __tablename__ = 'availabilities'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    date = Column(Date, nullable=False)
    slot = Column(String(20), nullable=False)  # 'morning', 'afternoon', 'evening'
    status = Column(String(20), nullable=False)  # 'available', 'unavailable', 'preferred'
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship('User', backref='availabilities')

class ShiftNote(Base):
    __tablename__ = 'shift_notes'
    
    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    author_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    author = relationship('User', backref='shift_notes')

class TimeOffRequest(Base):
    __tablename__ = 'time_off_requests'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    request_type = Column(String(20), nullable=False)  # 'vacation', 'sick'
    status = Column(String(20), default='pending')  # 'pending', 'approved', 'rejected'
    attachment_url = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship('User', backref='time_off_requests')

class Notification(Base):
    __tablename__ = 'notifications'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    title = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String(20), nullable=False)  # 'shift_reminder', 'swap_update', 'new_schedule'
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship('User', backref='notifications')

# =========================
#  ОБНОВЛЕННАЯ МОДЕЛЬ USER
# =========================
class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, unique=True, nullable=False)
    role = Column(String, default='user', nullable=False)
    phone = Column(String, nullable=True)
    language = Column(String, default='pl')
    theme = Column(String, default='light')
    font_size = Column(String, default='medium')
    quiet_hours_start = Column(Integer, default=22)
    quiet_hours_end = Column(Integer, default=8)
    fcm_token = Column(String, nullable=True)

    # связи
    shifts = relationship('Shift', back_populates='user', cascade="all, delete-orphan")
    outgoing_swaps = relationship('SwapRequest', foreign_keys='SwapRequest.from_user_id', back_populates='from_user')
    incoming_swaps = relationship('SwapRequest', foreign_keys='SwapRequest.to_user_id', back_populates='to_user')

    # утилиты
    def set_password(self, password): 
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password): 
        return check_password_hash(self.password_hash, password)

# =========================
#  ОБНОВЛЕННАЯ МОДЕЛЬ SHIFT
# =========================
class Shift(Base):
    __tablename__ = 'shifts'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    shift_date = Column(Date, nullable=False)
    shift_code = Column(String, nullable=False)
    hours = Column(Float, nullable=False)
    is_coordinator = Column(Boolean, default=False, nullable=False)
    color_hex = Column(String, nullable=True)
    actual_start = Column(DateTime, nullable=True)  # Для отметки времени прихода
    actual_end = Column(DateTime, nullable=True)    # Для отметки времени ухода
    qr_code = Column(String, nullable=True)         # QR код для отметки

    user = relationship('User', back_populates='shifts')

def to_dict(self):
    return {
        "id": self.id,
        "user_id": self.user_id,
        "date": self.shift_date.strftime('%Y-%m-%d'),
        "shift_code": self.shift_code,
        "hours": self.hours,
        "isCoordinator": bool(self.is_coordinator),
        "colorHex": self.color_hex,
        "actualStart": self.actual_start.isoformat() if self.actual_start else None,
        "actualEnd": self.actual_end.isoformat() if self.actual_end else None,
        "user": {
            "id": self.user.id,
            "full_name": self.user.full_name
        } if self.user else None
    }
    
    def generate_qr_code(self):
        # Генерация QR кода для смены
        qr_data = {
            "shift_id": self.id,
            "user_id": self.user_id,
            "date": self.shift_date.isoformat()
        }
        
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(str(qr_data))
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        
        # Сохраняем QR код как base64
        self.qr_code = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return self.qr_code

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
#  ОСНОВНЫЕ ЭНДПОИНТЫ
# =========================

# Регистрация пользователя

@jwt.unauthorized_loader
def unauthorized_callback(callback):
    return jsonify({'error': 'Missing or invalid token'}), 401

@jwt.invalid_token_loader
def invalid_token_callback(callback):
    return jsonify({'error': 'Invalid token'}), 401


@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    session = Session()
    
    try:
        # Проверяем, существует ли пользователь с таким email
        if session.query(User).filter_by(email=data['email']).first():
            return jsonify({'error': 'User with this email already exists'}), 400
        
        # Проверяем, существует ли пользователь с таким именем
        if session.query(User).filter_by(full_name=data['full_name']).first():
            return jsonify({'error': 'User with this name already exists'}), 400
        
        # Создаем нового пользователя
        user = User(
            email=data['email'],
            full_name=data['full_name'],
            role=data.get('role', 'user')
        )
        user.set_password(data['password'])
        
        session.add(user)
        session.commit()
        
        # Создаем JWT токен
        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={'role': user.role, 'email': user.email}
        )
        
        return jsonify({
            'message': 'User created successfully',
            'access_token': access_token,
            'user': {
                'id': user.id,
                'email': user.email,
                'full_name': user.full_name,
                'role': user.role
            }
        }), 201
        
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()



    
# Аутентификация пользователя
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    session = Session()
    
    try:
        user = session.query(User).filter_by(email=data['email']).first()
        
        if not user or not user.check_password(data['password']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Создаем JWT токен
        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={'role': user.role, 'email': user.email}
        )
        
        return jsonify({
            'access_token': access_token,
            'user': {
                'id': user.id,
                'email': user.email,
                'full_name': user.full_name,
                'role': user.role
            }
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Загрузка расписания
@app.route('/api/schedule/upload', methods=['POST'])
@jwt_required()
@admin_required()
def upload_schedule():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not file.filename.endswith('.pdf'):
        return jsonify({'error': 'Only PDF files are allowed'}), 400
    
    try:
        # Читаем PDF файл
        pdf_bytes = file.read()
        shifts_data = parse_pdf_with_colors(pdf_bytes)
        
        session = Session()
        
        # Очищаем существующие смены
        session.query(Shift).delete()
        
        # Парсим смены из PDF
        for shift_data in shifts_data:
            # Здесь должен быть ваш парсинг PDF и создание смен
            # Это упрощенный пример
            pass
        
        session.commit()
        return jsonify({'message': 'Schedule uploaded successfully'})
        
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Получение расписания на день
@app.route('/api/schedule/day', methods=['GET'])
@jwt_required()
def get_schedule_by_date_range():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    if not start_date or not end_date:
        return jsonify({'error': 'start_date and end_date parameters are required'}), 400
    
    try:
        start = datetime.strptime(start_date, '%Y-%m-%d').date()
        end = datetime.strptime(end_date, '%Y-%m-%d').date()
        
        session = Session()
        shifts = session.query(Shift).filter(
            Shift.shift_date >= start,
            Shift.shift_date <= end
        ).all()
        
        # Добавьте информацию о пользователе для каждой смены
        result = []
        for shift in shifts:
            shift_dict = shift.to_dict()
            shift_dict['user'] = {
                'id': shift.user.id,
                'full_name': shift.user.full_name
            }
            result.append(shift_dict)
        
        return jsonify(result)
        
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()
# Получение моего расписания
@app.route('/api/schedule/my-schedule', methods=['GET'])
@jwt_required()
def get_my_schedule():
    user_id = get_jwt_identity()
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    
    if not start_date or not end_date:
        return jsonify({'error': 'start_date and end_date parameters are required'}), 400
    
    try:
        start = datetime.strptime(start_date, '%Y-%m-%d').date()
        end = datetime.strptime(end_date, '%Y-%m-%d').date()
        
        session = Session()
        shifts = session.query(Shift).filter(
            Shift.user_id == user_id,
            Shift.shift_date >= start,
            Shift.shift_date <= end
        ).all()
        
        return jsonify([shift.to_dict() for shift in shifts])
        
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

@app.route('/api/notifications', methods=['GET'])
@jwt_required()
def get_notifications():
    user_id = get_jwt_identity()
    session = Session()
    try:
        notifications = session.query(Notification).filter_by(
            user_id=user_id
        ).order_by(Notification.created_at.desc()).all()
        
        return jsonify([{
            'id': n.id,
            'title': n.title,
            'message': n.message,
            'type': n.type,
            'is_read': n.is_read,
            'created_at': n.created_at.isoformat()
        } for n in notifications])
    finally:
        session.close()

@app.route('/api/notifications/<int:notification_id>/read', methods=['POST'])
@jwt_required()
def mark_notification_read(notification_id):
    user_id = get_jwt_identity()
    session = Session()
    try:
        notification = session.query(Notification).get(notification_id)
        
        if not notification or notification.user_id != int(user_id):
            return jsonify({'error': 'Notification not found or access denied'}), 404
        
        notification.is_read = True
        session.commit()
        
        return jsonify({'message': 'Notification marked as read'})
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()


@app.route('/api/me', methods=['GET'])
@jwt_required()
def get_current_user():
    user_id = get_jwt_identity()
    session = Session()
    try:
        user = session.query(User).get(user_id)
        return jsonify({
            'id': user.id,
            'email': user.email,
            'full_name': user.full_name,
            'role': user.role,
            'phone': user.phone,
            'language': user.language,
            'theme': user.theme,
            'font_size': user.font_size
        })
    finally:
        session.close()

@app.route('/api/users', methods=['GET'])
@jwt_required()
def get_users():
    session = Session()
    try:
        users = session.query(User).all()
        return jsonify([{
            'id': u.id,
            'email': u.email,
            'full_name': u.full_name,
            'role': u.role
        } for u in users])
    finally:
        session.close()


# Получение моих смен
@app.route('/api/me/shifts', methods=['GET'])
@jwt_required()
def get_my_shifts():
    user_id = get_jwt_identity()
    session = Session()
    
    try:
        # Получаем текущие и будущие смены
        today = date.today()
        shifts = session.query(Shift).filter(
            Shift.user_id == user_id,
            Shift.shift_date >= today
        ).order_by(Shift.shift_date).all()
        
        return jsonify([shift.to_dict() for shift in shifts])
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Создание запроса на обмен сменой
@app.route('/api/swaps', methods=['POST'])
@jwt_required()
def create_swap_request():
    user_id = get_jwt_identity()
    data = request.get_json()
    session = Session()
    
    try:
        # Проверяем, существует ли смена
        shift = session.query(Shift).get(data['shift_id'])
        if not shift or shift.user_id != int(user_id):
            return jsonify({'error': 'Shift not found or access denied'}), 404
        
        # Проверяем, существует ли целевой пользователь
        to_user = session.query(User).get(data['to_user_id'])
        if not to_user:
            return jsonify({'error': 'Target user not found'}), 404
        
        # Создаем запрос на обмен
        swap_request = SwapRequest(
            from_user_id=user_id,
            to_user_id=data['to_user_id'],
            shift_id=data['shift_id']
        )
        
        session.add(swap_request)
        
        # Создаем уведомление для целевого пользователя
        notification = Notification(
            user_id=data['to_user_id'],
            title='New Swap Request',
            message=f'{swap_request.from_user.full_name} wants to swap a shift with you',
            type='swap_request'
        )
        session.add(notification)
        
        session.commit()
        
        return jsonify({'message': 'Swap request created successfully'})
        
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Получение входящих запросов на обмен
@app.route('/api/swaps/incoming', methods=['GET'])
@jwt_required()
def get_incoming_swaps():
    user_id = get_jwt_identity()
    session = Session()
    
    try:
        swaps = session.query(SwapRequest).filter_by(to_user_id=user_id).all()
        
        result = []
        for swap in swaps:
            result.append({
                'id': swap.id,
                'from_user': {
                    'id': swap.from_user.id,
                    'name': swap.from_user.full_name
                },
                'shift': swap.shift.to_dict(),
                'status': swap.status,
                'created_at': swap.created_at.isoformat()
            })
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Получение исходящих запросов на обмен
@app.route('/api/swaps/outgoing', methods=['GET'])
@jwt_required()
def get_outgoing_swaps():
    user_id = get_jwt_identity()
    session = Session()
    
    try:
        swaps = session.query(SwapRequest).filter_by(from_user_id=user_id).all()
        
        result = []
        for swap in swaps:
            result.append({
                'id': swap.id,
                'to_user': {
                    'id': swap.to_user.id,
                    'name': swap.to_user.full_name
                },
                'shift': swap.shift.to_dict(),
                'status': swap.status,
                'created_at': swap.created_at.isoformat()
            })
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Принятие запроса на обмен
@app.route('/api/swaps/<int:swap_id>/accept', methods=['POST'])
@jwt_required()
def accept_swap(swap_id):
    user_id = get_jwt_identity()
    session = Session()
    
    try:
        swap = session.query(SwapRequest).get(swap_id)
        
        if not swap or swap.to_user_id != int(user_id):
            return jsonify({'error': 'Swap request not found or access denied'}), 404
        
        if swap.status != 'pending':
            return jsonify({'error': 'Swap request already processed'}), 400
        
        # Меняем владельца смены
        swap.shift.user_id = user_id
        swap.status = 'accepted'
        
        # Создаем уведомление для инициатора обмена
        notification = Notification(
            user_id=swap.from_user_id,
            title='Swap Request Accepted',
            message=f'{swap.to_user.full_name} accepted your swap request',
            type='swap_update'
        )
        session.add(notification)
        
        session.commit()
        
        return jsonify({'message': 'Swap request accepted successfully'})
        
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Отклонение запроса на обмен
@app.route('/api/swaps/<int:swap_id>/decline', methods=['POST'])
@jwt_required()
def decline_swap(swap_id):
    user_id = get_jwt_identity()
    session = Session()
    
    try:
        swap = session.query(SwapRequest).get(swap_id)
        
        if not swap or swap.to_user_id != int(user_id):
            return jsonify({'error': 'Swap request not found or access denied'}), 404
        
        if swap.status != 'pending':
            return jsonify({'error': 'Swap request already processed'}), 400
        
        swap.status = 'declined'
        
        # Создаем уведомление для инициатора обмена
        notification = Notification(
            user_id=swap.from_user_id,
            title='Swap Request Declined',
            message=f'{swap.to_user.full_name} declined your swap request',
            type='swap_update'
        )
        session.add(notification)
        
        session.commit()
        
        return jsonify({'message': 'Swap request declined successfully'})
        
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Отмена запроса на обмен
@app.route('/api/swaps/<int:swap_id>/cancel', methods=['POST'])
@jwt_required()
def cancel_swap(swap_id):
    user_id = get_jwt_identity()
    session = Session()
    
    try:
        swap = session.query(SwapRequest).get(swap_id)
        
        if not swap or swap.from_user_id != int(user_id):
            return jsonify({'error': 'Swap request not found or access denied'}), 404
        
        if swap.status != 'pending':
            return jsonify({'error': 'Cannot cancel processed swap request'}), 400
        
        # Создаем уведомление для целевого пользователя
        notification = Notification(
            user_id=swap.to_user_id,
            title='Swap Request Canceled',
            message=f'{swap.from_user.full_name} canceled the swap request',
            type='swap_update'
        )
        session.add(notification)
        
        session.delete(swap)
        session.commit()
        
        return jsonify({'message': 'Swap request canceled successfully'})
        
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# =========================
#  НОВЫЕ ЭНДПОИНТЫ ДЛЯ PWA
# =========================

# Эндпоинт для получения доступностей
@app.route('/api/availabilities', methods=['GET', 'POST'])
@jwt_required()
def handle_availabilities():
    user_id = get_jwt_identity()
    
    if request.method == 'GET':
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        if not start_date or not end_date:
            return jsonify({'error': 'start_date and end_date are required'}), 400
            
        session = Session()
        try:
            availabilities = session.query(Availability).filter(
                Availability.user_id == user_id,
                Availability.date >= start_date,
                Availability.date <= end_date
            ).all()
            
            return jsonify([{
                'id': a.id,
                'date': a.date.isoformat(),
                'slot': a.slot,
                'status': a.status
            } for a in availabilities])
        finally:
            session.close()
    
    else:  # POST
        data = request.get_json()
        session = Session()
        try:
            # Удаляем существующую запись для этого дня и слота
            existing = session.query(Availability).filter_by(
                user_id=user_id,
                date=datetime.strptime(data['date'], '%Y-%m-%d').date(),
                slot=data['slot']
            ).first()
            
            if existing:
                session.delete(existing)
            
            # Создаем новую запись
            availability = Availability(
                user_id=user_id,
                date=datetime.strptime(data['date'], '%Y-%m-%d').date(),
                slot=data['slot'],
                status=data['status']
            )
            
            session.add(availability)
            session.commit()
            
            return jsonify({'message': 'Availability updated successfully'})
        except Exception as e:
            session.rollback()
            return jsonify({'error': str(e)}), 500
        finally:
            session.close()

# Эндпоинт для заметок к сменам
@app.route('/api/shift-notes', methods=['GET', 'POST'])
@jwt_required()
def handle_shift_notes():
    if request.method == 'GET':
        date_str = request.args.get('date')
        if not date_str:
            return jsonify({'error': 'date parameter is required'}), 400
            
        session = Session()
        try:
            notes = session.query(ShiftNote).filter_by(
                date=datetime.strptime(date_str, '%Y-%m-%d').date()
            ).order_by(ShiftNote.created_at.desc()).all()
            
            return jsonify([{
                'id': n.id,
                'text': n.text,
                'author': n.author.full_name,
                'created_at': n.created_at.isoformat()
            } for n in notes])
        finally:
            session.close()
    
    else:  # POST
        user_id = get_jwt_identity()
        data = request.get_json()
        session = Session()
        try:
            note = ShiftNote(
                date=datetime.strptime(data['date'], '%Y-%m-%d').date(),
                author_id=user_id,
                text=data['text']
            )
            
            session.add(note)
            session.commit()
            
            return jsonify({'message': 'Note added successfully'})
        except Exception as e:
            session.rollback()
            return jsonify({'error': str(e)}), 500
        finally:
            session.close()

# Эндпоинт для сегодняшних смен
@app.route('/api/today-shifts', methods=['GET'])
@jwt_required()
def get_today_shifts():
    today = datetime.now().date()
    session = Session()
    try:
        shifts = session.query(Shift).filter_by(shift_date=today).all()
        
        result = []
        for shift in shifts:
            user = session.query(User).get(shift.user_id)
            
            result.append({
                'id': shift.id,
                'start_time': shift.shift_code.split('-')[0] if '-' in shift.shift_code else '08:00',
                'end_time': shift.shift_code.split('-')[1] if '-' in shift.shift_code else '16:00',
                'user': {
                    'id': user.id,
                    'name': user.full_name,
                    'phone': user.phone,
                    'role': user.role
                }
            })
        
        return jsonify(result)
    finally:
        session.close()

# Эндпоинт для отметки времени (QR код)
@app.route('/api/shifts/<int:shift_id>/check-in', methods=['POST'])
@jwt_required()
def check_in(shift_id):
    user_id = get_jwt_identity()
    session = Session()
    try:
        shift = session.query(Shift).get(shift_id)
        
        if not shift or shift.user_id != int(user_id):
            return jsonify({'error': 'Shift not found or access denied'}), 404
        
        shift.actual_start = datetime.now()
        session.commit()
        
        return jsonify({'message': 'Check-in successful', 'time': shift.actual_start.isoformat()})
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

@app.route('/api/shifts/<int:shift_id>/check-out', methods=['POST'])
@jwt_required()
def check_out(shift_id):
    user_id = get_jwt_identity()
    session = Session()
    try:
        shift = session.query(Shift).get(shift_id)
        
        if not shift or shift.user_id != int(user_id):
            return jsonify({'error': 'Shift not found or access denied'}), 404
        
        shift.actual_end = datetime.now()
        session.commit()
        
        return jsonify({'message': 'Check-out successful', 'time': shift.actual_end.isoformat()})
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Эндпоинт для генерации QR кода
@app.route('/api/shifts/<int:shift_id>/qr-code', methods=['GET'])
@jwt_required()
def get_qr_code(shift_id):
    user_id = get_jwt_identity()
    session = Session()
    try:
        shift = session.query(Shift).get(shift_id)
        
        if not shift or shift.user_id != int(user_id):
            return jsonify({'error': 'Shift not found or access denied'}), 404
        
        if not shift.qr_code:
            shift.generate_qr_code()
            session.commit()
        
        return jsonify({'qr_code': shift.qr_code})
    finally:
        session.close()

# Эндпоинт для запросов на отгул
@app.route('/api/time-off-requests', methods=['GET', 'POST'])
@jwt_required()
def handle_time_off_requests():
    user_id = get_jwt_identity()
    
    if request.method == 'GET':
        session = Session()
        try:
            requests = session.query(TimeOffRequest).filter_by(
                user_id=user_id
            ).order_by(TimeOffRequest.created_at.desc()).all()
            
            return jsonify([{
                'id': r.id,
                'start_date': r.start_date.isoformat(),
                'end_date': r.end_date.isoformat(),
                'type': r.request_type,
                'status': r.status,
                'attachment_url': r.attachment_url,
                'created_at': r.created_at.isoformat()
            } for r in requests])
        finally:
            session.close()
    
    else:  # POST
        data = request.get_json()
        session = Session()
        try:
            time_off_request = TimeOffRequest(
                user_id=user_id,
                start_date=datetime.strptime(data['start_date'], '%Y-%m-%d').date(),
                end_date=datetime.strptime(data['end_date'], '%Y-%m-%d').date(),
                request_type=data['type'],
                attachment_url=data.get('attachment_url')
            )
            
            session.add(time_off_request)
            session.commit()
            
            # Уведомление для администраторов
            admins = session.query(User).filter_by(role='admin').all()
            for admin in admins:
                notification = Notification(
                    user_id=admin.id,
                    title='New Time Off Request',
                    message=f'{time_off_request.user.full_name} submitted a time off request',
                    type='time_off_request'
                )
                session.add(notification)
            
            session.commit()
            
            return jsonify({'message': 'Time off request submitted successfully'})
        except Exception as e:
            session.rollback()
            return jsonify({'error': str(e)}), 500
        finally:
            session.close()

# Эндпоинт для обновления профиля
@app.route('/api/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    data = request.get_json()
    session = Session()
    try:
        user = session.query(User).get(user_id)
        
        if 'language' in data:
            user.language = data['language']
        if 'theme' in data:
            user.theme = data['theme']
        if 'font_size' in data:
            user.font_size = data['font_size']
        if 'quiet_hours_start' in data:
            user.quiet_hours_start = data['quiet_hours_start']
        if 'quiet_hours_end' in data:
            user.quiet_hours_end = data['quiet_hours_end']
        if 'fcm_token' in data:
            user.fcm_token = data['fcm_token']
        
        session.commit()
        return jsonify({'message': 'Profile updated successfully'})
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# Эндпоинт для экстренных уведомлений
@app.route('/api/emergency-notification', methods=['POST'])
@jwt_required()
def send_emergency_notification():
    user_id = get_jwt_identity()
    data = request.get_json()
    
    session = Session()
    try:
        # Получаем информацию о смене, которую нужно заменить
        shift_id = data.get('shift_id')
        shift = session.query(Shift).get(shift_id)
        
        if not shift or shift.user_id != int(user_id):
            return jsonify({'error': 'Shift not found or access denied'}), 404
        
        # Находим подходящих сотрудников (по роли и доступности)
        suitable_users = session.query(User).filter(
            User.role == shift.user.role,
            User.id != user_id
        ).all()
        
        # Создаем уведомления для подходящих сотрудников
        for user in suitable_users:
            notification = Notification(
                user_id=user.id,
                title='Emergency Shift Replacement',
                message=f'{shift.user.full_name} cannot attend their shift on {shift.shift_date}. Can you take it?',
                type='emergency'
            )
            session.add(notification)
        
        session.commit()
        
        return jsonify({
            'message': 'Emergency notifications sent successfully',
            'recipients_count': len(suitable_users)
        })
    except Exception as e:
        session.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        session.close()

# =========================
#  ОБНОВЛЕННАЯ ФУНКЦИЯ ЗАГРУЗКИ PDF
# =========================
# Добавим улучшенный парсинг PDF с поддержкой цветов ячеек
def parse_pdf_with_colors(pdf_bytes):
    """Улучшенный парсер PDF с распознаванием цветов ячеек"""
    shifts = []
    
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page_num, page in enumerate(pdf.pages):
            # Извлекаем таблицы с настройками для сохранения позиции ячеек
            tables = page.extract_tables({
                "vertical_strategy": "lines", 
                "horizontal_strategy": "lines",
                "explicit_vertical_lines": page.curves + page.edges,
                "explicit_horizontal_lines": page.curves + page.edges,
            })
            
            # Извлекаем заливку ячеек (цвет)
            rects = page.rects + page.curves  # rects содержат информацию о заливке
            
            for table in tables:
                for row_idx, row in enumerate(table):
                    for col_idx, cell in enumerate(row):
                        if cell and isinstance(cell, str) and cell.strip():
                            # Определяем координаты ячейки
                            cell_bbox = (
                                col_idx * 100,  # Примерные координаты
                                row_idx * 20,
                                (col_idx + 1) * 100,
                                (row_idx + 1) * 20
                            )
                            
                            # Проверяем цвет ячейки
                            is_coordinator = False
                            color_hex = None
                            
                            for rect in rects:
                                # Проверяем пересечение rect с ячейкой
                                if (rect['x0'] >= cell_bbox[0] and rect['x1'] <= cell_bbox[2] and
                                    rect['y0'] >= cell_bbox[1] and rect['y1'] <= cell_bbox[3]):
                                    if rect.get('fill'):  # Если есть заливка
                                        is_coordinator = True
                                        # Конвертируем цвет в HEX
                                        if isinstance(rect['fill'], tuple):
                                            color_hex = '#{:02x}{:02x}{:02x}'.format(
                                                int(rect['fill'][0] * 255),
                                                int(rect['fill'][1] * 255),
                                                int(rect['fill'][2] * 255)
                                            )
                                        break
                            
                            shifts.append({
                                'text': cell.strip(),
                                'page': page_num + 1,
                                'is_coordinator': is_coordinator,
                                'color_hex': color_hex
                            })
    
    return shifts
# Обслуживание статических файлов
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    if path != "" and os.path.exists(os.path.join('static', path)):
        return send_from_directory('static', path)
    else:
        return send_from_directory('static', 'index.html')









from werkzeug.security import generate_password_hash

@app.route('/generate_hash', methods=['POST'])
def generate_hash():
    data = request.get_json()
    password = data.get('password')
    
    if not password:
        return jsonify({'error': 'Password is required'}), 400
    
    password_hash = generate_password_hash(password)
    return jsonify({'hash': password_hash})




# =========================
#  ЗАПУСК ПРИЛОЖЕНИЯ
# =========================
if __name__ == '__main__':
    try:
        # Создаем все таблицы
        Base.metadata.create_all(engine)
        print("!!! Successfully connected to the database and ensured tables exist.")
    except Exception as e:
        print(f"!!! FAILED to connect to the database. Error: {e}")
        exit(1)

    app.run(host='0.0.0.0', port=5000, debug=True)












