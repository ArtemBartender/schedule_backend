```python
import os
import io
import logging
import traceback
from datetime import datetime, timedelta, date
from functools import wraps

from flask import Flask, request, jsonify, send_file, send_from_directory, Response
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, DateTime, Boolean, ForeignKey, Text
from sqlalchemy.orm import sessionmaker, relationship, declarative_base, scoped_session
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, JWTManager, get_jwt
from flask_cors import CORS
import pdfplumber
import qrcode
from io import BytesIO
import base64

# =========================
# НАСТРОЙКА ПРИЛОЖЕНИЯ
# =========================
app = Flask(__name__)

# Настройка CORS
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# Настройка логирования для Render
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler()  # Логи в stdout для Render
    ]
)
logger = logging.getLogger(__name__)

# Конфигурация из переменных окружения
DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///local.db')
JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'dev-secret-key-change-in-production')

if not DATABASE_URL or not JWT_SECRET_KEY:
    logger.error("DATABASE_URL or JWT_SECRET_KEY not set in environment variables")
    raise RuntimeError("Missing critical environment variables")

app.config['JWT_SECRET_KEY'] = JWT_SECRET_KEY
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=14)

# Настройка базы данных
engine = create_engine(DATABASE_URL)
Session = scoped_session(sessionmaker(bind=engine))
Base = declarative_base()
jwt = JWTManager(app)

@app.teardown_appcontext
def shutdown_session(exception=None):
    Session.remove()

# =========================
# МОДЕЛИ
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

    shifts = relationship('Shift', back_populates='user', cascade="all, delete-orphan")
    outgoing_swaps = relationship('SwapRequest', foreign_keys='SwapRequest.from_user_id', 
                                back_populates='from_user', cascade="all, delete-orphan")
    incoming_swaps = relationship('SwapRequest', foreign_keys='SwapRequest.to_user_id', 
                                back_populates='to_user', cascade="all, delete-orphan")
    availabilities = relationship('Availability', backref='user', cascade="all, delete-orphan")
    shift_notes = relationship('ShiftNote', backref='author', cascade="all, delete-orphan")
    time_off_requests = relationship('TimeOffRequest', backref='user', cascade="all, delete-orphan")
    notifications = relationship('Notification', backref='user', cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

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
            "id": self.id,
            "user_id": self.user_id,
            "date": self.shift_date.strftime('%Y-%m-%d'),
            "shift_code": self.shift_code,
            "hours": self.hours,
            "is_coordinator": bool(self.is_coordinator),
            "color_hex": self.color_hex,
            "actual_start": self.actual_start.isoformat() if self.actual_start else None,
            "actual_end": self.actual_end.isoformat() if self.actual_end else None,
            "user": {
                "id": self.user.id,
                "full_name": self.user.full_name
            } if self.user else None
        }

    def generate_qr_code(self):
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
        self.qr_code = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return self.qr_code

class SwapRequest(Base):
    __tablename__ = 'swap_requests'
    
    id = Column(Integer, primary_key=True)
    from_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    to_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    shift_id = Column(Integer, ForeignKey('shifts.id', ondelete='CASCADE'), nullable=False)
    status = Column(String(20), default='pending')
    created_at = Column(DateTime, default=datetime.utcnow)
    
    from_user = relationship('User', foreign_keys=[from_user_id], back_populates='outgoing_swaps')
    to_user = relationship('User', foreign_keys=[to_user_id], back_populates='incoming_swaps')
    shift = relationship('Shift')

class Availability(Base):
    __tablename__ = 'availabilities'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    date = Column(Date, nullable=False)
    slot = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship('User', back_populates='availabilities')

class ShiftNote(Base):
    __tablename__ = 'shift_notes'
    
    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    author_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    author = relationship('User', back_populates='shift_notes')

class TimeOffRequest(Base):
    __tablename__ = 'time_off_requests'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    request_type = Column(String(20), nullable=False)
    status = Column(String(20), default='pending')
    attachment_url = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship('User', back_populates='time_off_requests')

class Notification(Base):
    __tablename__ = 'notifications'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    title = Column(String(100), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String(20), nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship('User', back_populates='notifications')

# =========================
# ДЕКОРАТОРЫ
# =========================
def admin_required():
    def wrapper(fn):
        @wraps(fn)
        @jwt_required()
        def decorator(*args, **kwargs):
            claims = get_jwt()
            if claims.get('role') == 'admin':
                return fn(*args, **kwargs)
            return jsonify({'error': 'Wymagane uprawnienia administratora!'}), 403
        return decorator
    return wrapper

# =========================
# ЭНДПОИНТЫ
# =========================

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    session = Session()
    
    try:
        if not data.get('email') or not data.get('password') or not data.get('full_name'):
            return jsonify({'error': 'Email, password, and full_name are required'}), 400
        
        if session.query(User).filter_by(email=data['email']).first():
            return jsonify({'error': 'User with this email already exists'}), 400
        
        if session.query(User).filter_by(full_name=data['full_name']).first():
            return jsonify({'error': 'User with this name already exists'}), 400
        
        user = User(
            email=data['email'],
            full_name=data['full_name'],
            role=data.get('role', 'user'),
            phone=data.get('phone')
        )
        user.set_password(data['password'])
        
        session.add(user)
        session.commit()
        
        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={'role': user.role, 'email': user.email}
        )
        
        logger.info(f"User registered: {user.email}")
        return jsonify({
            'message': 'User created successfully',
            'access_token': access_token,
            'user': {
                'id': user.id,
                'email': user.email,
                'full_name': user.full_name,
                'role': user.role,
                'phone': user.phone
            }
        }), 201
    
    except Exception as e:
        session.rollback()
        logger.error(f"Registration error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred during registration'}), 500
    finally:
        session.close()

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    session = Session()
    
    try:
        if not data.get('email') or not data.get('password'):
            return jsonify({'error': 'Email and password are required'}), 400
        
        user = session.query(User).filter_by(email=data['email']).first()
        
        if not user or not user.check_password(data['password']):
            logger.warning(f"Failed login attempt for email: {data['email']}")
            return jsonify({'error': 'Invalid credentials'}), 401
        
        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={'role': user.role, 'email': user.email}
        )
        
        logger.info(f"User logged in: {user.email}")
        return jsonify({
            'access_token': access_token,
            'user': {
                'id': user.id,
                'email': user.email,
                'full_name': user.full_name,
                'role': user.role,
                'phone': user.phone
            }
        })
    
    except Exception as e:
        logger.error(f"Login error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred during login'}), 500
    finally:
        session.close()

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
    
    session = Session()
    try:
        pdf_bytes = file.read()
        shifts_data = parse_pdf_with_colors(pdf_bytes)
        
        session.query(Shift).delete()
        
        for shift_data in shifts_data:
            user = session.query(User).filter_by(full_name=shift_data.get('user_name')).first()
            if not user:
                logger.warning(f"User not found for name: {shift_data.get('user_name')}")
                continue
            
            try:
                shift_date = datetime.strptime(shift_data['date'], '%Y-%m-%d').date()
            except (ValueError, KeyError):
                logger.warning(f"Invalid date format for shift: {shift_data.get('text')}")
                continue
            
            shift = Shift(
                user_id=user.id,
                shift_date=shift_date,
                shift_code=shift_data['text'],
                hours=shift_data.get('hours', 8.0),
                is_coordinator=shift_data.get('is_coordinator', False),
                color_hex=shift_data.get('color_hex')
            )
            session.add(shift)
        
        session.commit()
        logger.info("Schedule uploaded successfully")
        return jsonify({'message': 'Schedule uploaded successfully'})
    
    except Exception as e:
        session.rollback()
        logger.error(f"Schedule upload error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred during schedule upload'}), 500
    finally:
        session.close()

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
        
        return jsonify([shift.to_dict() for shift in shifts])
    
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
    except Exception as e:
        logger.error(f"Get schedule error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

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
        logger.error(f"Get my schedule error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

@app.route('/api/swaps', methods=['GET', 'POST'])
@jwt_required()
def handle_swaps():
    user_id = get_jwt_identity()
    session = Session()
    
    if request.method == 'GET':
        try:
            incoming = session.query(SwapRequest).filter_by(to_user_id=user_id).all()
            outgoing = session.query(SwapRequest).filter_by(from_user_id=user_id).all()
            
            result = []
            for swap in incoming + outgoing:
                result.append({
                    'id': swap.id,
                    'from_user': {
                        'id': swap.from_user.id,
                        'full_name': swap.from_user.full_name
                    },
                    'to_user': {
                        'id': swap.to_user.id,
                        'full_name': swap.to_user.full_name
                    },
                    'shift': swap.shift.to_dict(),
                    'status': swap.status,
                    'created_at': swap.created_at.isoformat()
                })
            
            return jsonify(result)
        
        except Exception as e:
            logger.error(f"Get swaps error: {str(e)}\n{traceback.format_exc()}")
            return jsonify({'error': 'An error occurred'}), 500
        finally:
            session.close()
    
    else:  # POST
        data = request.get_json()
        try:
            shift = session.query(Shift).get(data['shift_id'])
            if not shift or shift.user_id != int(user_id):
                return jsonify({'error': 'Shift not found or access denied'}), 404
            
            to_user = session.query(User).get(data['to_user_id'])
            if not to_user:
                return jsonify({'error': 'Target user not found'}), 404
            
            swap_request = SwapRequest(
                from_user_id=user_id,
                to_user_id=data['to_user_id'],
                shift_id=data['shift_id']
            )
            
            session.add(swap_request)
            
            notification = Notification(
                user_id=data['to_user_id'],
                title='Nowa prośba o zamianę',
                message=f'{swap_request.from_user.full_name} chce zamienić się z Tobą zmianą',
                type='swap_request'
            )
            session.add(notification)
            
            session.commit()
            logger.info(f"Swap request created by user {user_id} for shift {data['shift_id']}")
            return jsonify({'message': 'Swap request created successfully'})
        
        except Exception as e:
            session.rollback()
            logger.error(f"Create swap error: {str(e)}\n{traceback.format_exc()}")
            return jsonify({'error': 'An error occurred'}), 500
        finally:
            session.close()

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
        
        swap.shift.user_id = user_id
        swap.status = 'accepted'
        
        notification = Notification(
            user_id=swap.from_user_id,
            title='Prośba o zamianę zaakceptowana',
            message=f'{swap.to_user.full_name} zaakceptował Twoją prośbę o zamianę',
            type='swap_update'
        )
        session.add(notification)
        
        session.commit()
        logger.info(f"Swap request {swap_id} accepted by user {user_id}")
        return jsonify({'message': 'Swap request accepted successfully'})
    
    except Exception as e:
        session.rollback()
        logger.error(f"Accept swap error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

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
        
        notification = Notification(
            user_id=swap.from_user_id,
            title='Prośba o zamianę odrzucona',
            message=f'{swap.to_user.full_name} odrzucił Twoją prośbę o zamianę',
            type='swap_update'
        )
        session.add(notification)
        
        session.commit()
        logger.info(f"Swap request {swap_id} declined by user {user_id}")
        return jsonify({'message': 'Swap request declined successfully'})
    
    except Exception as e:
        session.rollback()
        logger.error(f"Decline swap error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

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
        
        notification = Notification(
            user_id=swap.to_user_id,
            title='Prośba o zamianę anulowana',
            message=f'{swap.from_user.full_name} anulował prośbę o zamianę',
            type='swap_update'
        )
        session.add(notification)
        
        session.delete(swap)
        session.commit()
        logger.info(f"Swap request {swap_id} canceled by user {user_id}")
        return jsonify({'message': 'Swap request canceled successfully'})
    
    except Exception as e:
        session.rollback()
        logger.error(f"Cancel swap error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
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
    
    except Exception as e:
        logger.error(f"Get notifications error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
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
        logger.info(f"Notification {notification_id} marked as read by user {user_id}")
        return jsonify({'message': 'Notification marked as read'})
    
    except Exception as e:
        session.rollback()
        logger.error(f"Mark notification read error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
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
            'font_size': user.font_size,
            'quiet_hours_start': user.quiet_hours_start,
            'quiet_hours_end': user.quiet_hours_end,
            'fcm_token': user.fcm_token
        })
    
    except Exception as e:
        logger.error(f"Get current user error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
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
    
    except Exception as e:
        logger.error(f"Get users error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

@app.route('/api/availabilities', methods=['GET', 'POST'])
@jwt_required()
def handle_availabilities():
    user_id = get_jwt_identity()
    
    if request.method == 'GET':
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        if not start_date or not end_date:
            return jsonify({'error': 'start_date and end_date are required'}), 400
        
        try:
            start = datetime.strptime(start_date, '%Y-%m-%d').date()
            end = datetime.strptime(end_date, '%Y-%m-%d').date()
            
            session = Session()
            availabilities = session.query(Availability).filter(
                Availability.user_id == user_id,
                Availability.date >= start,
                Availability.date <= end
            ).all()
            
            return jsonify([{
                'id': a.id,
                'date': a.date.isoformat(),
                'slot': a.slot,
                'status': a.status
            } for a in availabilities])
        
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        except Exception as e:
            logger.error(f"Get availabilities error: {str(e)}\n{traceback.format_exc()}")
            return jsonify({'error': 'An error occurred'}), 500
        finally:
            session.close()
    
    else:  # POST
        data = request.get_json()
        session = Session()
        try:
            if not data.get('date') or not data.get('slot') or not data.get('status'):
                return jsonify({'error': 'date, slot, and status are required'}), 400
            
            date_obj = datetime.strptime(data['date'], '%Y-%m-%d').date()
            if data['slot'] not in ['morning', 'afternoon', 'evening']:
                return jsonify({'error': 'Invalid slot value'}), 400
            if data['status'] not in ['available', 'unavailable', 'preferred']:
                return jsonify({'error': 'Invalid status value'}), 400
            
            existing = session.query(Availability).filter_by(
                user_id=user_id,
                date=date_obj,
                slot=data['slot']
            ).first()
            
            if existing:
                session.delete(existing)
            
            availability = Availability(
                user_id=user_id,
                date=date_obj,
                slot=data['slot'],
                status=data['status']
            )
            
            session.add(availability)
            session.commit()
            logger.info(f"Availability updated for user {user_id} on {data['date']} slot {data['slot']}")
            return jsonify({'message': 'Availability updated successfully'})
    
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        except Exception as e:
            session.rollback()
            logger.error(f"Update availability error: {str(e)}\n{traceback.format_exc()}")
            return jsonify({'error': 'An error occurred'}), 500
        finally:
            session.close()

@app.route('/api/shift-notes', methods=['GET', 'POST'])
@jwt_required()
def handle_shift_notes():
    if request.method == 'GET':
        date_str = request.args.get('date')
        if not date_str:
            return jsonify({'error': 'date parameter is required'}), 400
        
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
            session = Session()
            notes = session.query(ShiftNote).filter_by(date=date_obj).order_by(ShiftNote.created_at.desc()).all()
            
            return jsonify([{
                'id': n.id,
                'text': n.text,
                'author': n.author.full_name,
                'created_at': n.created_at.isoformat()
            } for n in notes])
        
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        except Exception as e:
            logger.error(f"Get shift notes error: {str(e)}\n{traceback.format_exc()}")
            return jsonify({'error': 'An error occurred'}), 500
        finally:
            session.close()
    
    else:  # POST
        user_id = get_jwt_identity()
        data = request.get_json()
        session = Session()
        try:
            if not data.get('date') or not data.get('text'):
                return jsonify({'error': 'date and text are required'}), 400
            
            date_obj = datetime.strptime(data['date'], '%Y-%m-%d').date()
            note = ShiftNote(
                date=date_obj,
                author_id=user_id,
                text=data['text']
            )
            
            session.add(note)
            session.commit()
            logger.info(f"Shift note added by user {user_id} for date {data['date']}")
            return jsonify({'message': 'Note added successfully'})
        
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        except Exception as e:
            session.rollback()
            logger.error(f"Add shift note error: {str(e)}\n{traceback.format_exc()}")
            return jsonify({'error': 'An error occurred'}), 500
        finally:
            session.close()

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
                'is_coordinator': shift.is_coordinator,
                'user': {
                    'id': user.id,
                    'full_name': user.full_name,
                    'phone': user.phone,
                    'role': user.role
                }
            })
        
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"Get today shifts error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

@app.route('/api/shifts/<int:shift_id>/check-in', methods=['POST'])
@jwt_required()
def check_in(shift_id):
    user_id = get_jwt_identity()
    session = Session()
    
    try:
        shift = session.query(Shift).get(shift_id)
        
        if not shift or shift.user_id != int(user_id):
            return jsonify({'error': 'Shift not found or access denied'}), 404
        
        if shift.actual_start:
            return jsonify({'error': 'Shift already checked in'}), 400
        
        shift.actual_start = datetime.now()
        session.commit()
        logger.info(f"Check-in for shift {shift_id} by user {user_id}")
        return jsonify({'message': 'Check-in successful', 'time': shift.actual_start.isoformat()})
    
    except Exception as e:
        session.rollback()
        logger.error(f"Check-in error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
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
        
        if not shift.actual_start:
            return jsonify({'error': 'Cannot check out before checking in'}), 400
        if shift.actual_end:
            return jsonify({'error': 'Shift already checked out'}), 400
        
        shift.actual_end = datetime.now()
        session.commit()
        logger.info(f"Check-out for shift {shift_id} by user {user_id}")
        return jsonify({'message': 'Check-out successful', 'time': shift.actual_end.isoformat()})
    
    except Exception as e:
        session.rollback()
        logger.error(f"Check-out error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

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
        
        except Exception as e:
            logger.error(f"Get time off requests error: {str(e)}\n{traceback.format_exc()}")
            return jsonify({'error': 'An error occurred'}), 500
        finally:
            session.close()
    
    else:  # POST
        data = request.get_json()
        session = Session()
        try:
            if not data.get('start_date') or not data.get('end_date') or not data.get('type'):
                return jsonify({'error': 'start_date, end_date, and type are required'}), 400
            
            start_date = datetime.strptime(data['start_date'], '%Y-%m-%d').date()
            end_date = datetime.strptime(data['end_date'], '%Y-%m-%d').date()
            if end_date < start_date:
                return jsonify({'error': 'end_date cannot be before start_date'}), 400
            
            time_off_request = TimeOffRequest(
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
                request_type=data['type'],
                attachment_url=data.get('attachment_url')
            )
            
            session.add(time_off_request)
            
            admins = session.query(User).filter_by(role='admin').all()
            for admin in admins:
                notification = Notification(
                    user_id=admin.id,
                    title='Nowy wniosek o urlop',
                    message=f'{time_off_request.user.full_name} złożył wniosek o urlop',
                    type='time_off_request'
                )
                session.add(notification)
            
            session.commit()
            logger.info(f"Time off request submitted by user {user_id}")
            return jsonify({'message': 'Time off request submitted successfully'})
        
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        except Exception as e:
            session.rollback()
            logger.error(f"Submit time off request error: {str(e)}\n{traceback.format_exc()}")
            return jsonify({'error': 'An error occurred'}), 500
        finally:
            session.close()

@app.route('/api/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    user_id = get_jwt_identity()
    data = request.get_json()
    session = Session()
    
    try:
        user = session.query(User).get(user_id)
        
        if 'full_name' in data:
            if session.query(User).filter(User.full_name == data['full_name'], User.id != user_id).first():
                return jsonify({'error': 'User with this full_name already exists'}), 400
            user.full_name = data['full_name']
        
        if 'email' in data:
            if session.query(User).filter(User.email == data['email'], User.id != user_id).first():
                return jsonify({'error': 'User with this email already exists'}), 400
            user.email = data['email']
        
        if 'phone' in data:
            user.phone = data['phone']
        
        if 'language' in data:
            user.language = data['language']
        if 'theme' in data:
            user.theme = data['theme']
        if 'font_size' in data:
            if data['font_size'] not in ['small', 'medium', 'large']:
                return jsonify({'error': 'Invalid font_size value'}), 400
            user.font_size = data['font_size']
        if 'quiet_hours_start' in data:
            user.quiet_hours_start = int(data['quiet_hours_start'])
        if 'quiet_hours_end' in data:
            user.quiet_hours_end = int(data['quiet_hours_end'])
        if 'fcm_token' in data:
            user.fcm_token = data['fcm_token']
        
        session.commit()
        logger.info(f"Profile updated for user {user_id}")
        return jsonify({
            'message': 'Profile updated successfully',
            'user': {
                'id': user.id,
                'email': user.email,
                'full_name': user.full_name,
                'role': user.role,
                'phone': user.phone,
                'language': user.language,
                'theme': user.theme,
                'font_size': user.font_size,
                'quiet_hours_start': user.quiet_hours_start,
                'quiet_hours_end': user.quiet_hours_end
            }
        })
    
    except Exception as e:
        session.rollback()
        logger.error(f"Update profile error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

@app.route('/api/emergency-notification', methods=['POST'])
@jwt_required()
def send_emergency_notification():
    user_id = get_jwt_identity()
    data = request.get_json()
    session = Session()
    
    try:
        shift_id = data.get('shift_id')
        shift = session.query(Shift).get(shift_id)
        
        if not shift or shift.user_id != int(user_id):
            return jsonify({'error': 'Shift not found or access denied'}), 404
        
        suitable_users = session.query(User).filter(
            User.role == shift.user.role,
            User.id != user_id
        ).all()
        
        for user in suitable_users:
            notification = Notification(
                user_id=user.id,
                title='Pilna zamiana zmiany',
                message=f'{shift.user.full_name} nie może stawić się na zmianę w dniu {shift.shift_date}. Czy możesz ją przejąć?',
                type='emergency'
            )
            session.add(notification)
        
        session.commit()
        logger.info(f"Emergency notifications sent by user {user_id} for shift {shift_id}")
        return jsonify({
            'message': 'Emergency notifications sent successfully',
            'recipients_count': len(suitable_users)
        })
    
    except Exception as e:
        session.rollback()
        logger.error(f"Send emergency notification error: {str(e)}\n{traceback.format_exc()}")
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        session.close()

def parse_pdf_with_colors(pdf_bytes):
    shifts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page_num, page in enumerate(pdf.pages):
            tables = page.extract_tables({
                "vertical_strategy": "lines",
                "horizontal_strategy": "lines",
                "explicit_vertical_lines": page.curves + page.edges,
                "explicit_horizontal_lines": page.curves + page.edges,
            })
            
            rects = page.rects + page.curves
            current_date = None  # Для отслеживания текущей даты
            
            for table in tables:
                for row_idx, row in enumerate(table):
                    for col_idx, cell in enumerate(row):
                        if cell and isinstance(cell, str) and cell.strip():
                            # Предполагаем, что первая колонка содержит даты
                            if col_idx == 0 and '-' in cell:
                                try:
                                    current_date = datetime.strptime(cell.strip(), '%Y-%m-%d').date()
                                    continue
                                except ValueError:
                                    pass
                            
                            # Пропускаем заголовки
                            if cell.lower() in ['date', 'data', 'name', 'nazwisko']:
                                continue
                            
                            cell_bbox = (
                                col_idx * 100,
                                row_idx * 20,
                                (col_idx + 1) * 100,
                                (row_idx + 1) * 20
                            )
                            
                            is_coordinator = False
                            color_hex = None
                            
                            for rect in rects:
                                if (rect['x0'] >= cell_bbox[0] and rect['x1'] <= cell_bbox[2] and
                                    rect['y0'] >= cell_bbox[1] and rect['y1'] <= cell_bbox[3]):
                                    if rect.get('fill'):
                                        is_coordinator = True
                                        if isinstance(rect['fill'], tuple):
                                            color_hex = '#{:02x}{:02x}{:02x}'.format(
                                                int(rect['fill'][0] * 255),
                                                int(rect['fill'][1] * 255),
                                                int(rect['fill'][2] * 255)
                                            )
                                        break
                            
                            # Предполагаем, что ячейка содержит имя пользователя и код смены
                            parts = cell.strip().split('\n')
                            user_name = parts[0] if parts else cell.strip()
                            shift_code = parts[1] if len(parts) > 1 else cell.strip()
                            
                            shifts.append({
                                'user_name': user_name,
                                'text': shift_code,
                                'date': current_date.isoformat() if current_date else None,
                                'hours': 8.0,  # Значение по умолчанию, нужно уточнить
                                'is_coordinator': is_coordinator,
                                'color_hex': color_hex,
                                'page': page_num + 1
                            })
    
    return shifts

@app.route('/sw.js')
def serve_service_worker():
    response = send_from_directory('static', 'sw.js')
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Content-Type'] = 'application/javascript'
    return response

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    static_dir = 'static'
    if path == '' or path == 'index.html':
        return send_from_directory(static_dir, 'index.html')
    if os.path.exists(os.path.join(static_dir, path)):
        return send_from_directory(static_dir, path)
    return send_from_directory(static_dir, 'index.html')

@jwt.unauthorized_loader
def unauthorized_callback(callback):
    return jsonify({'error': 'Missing or invalid token'}), 401

@jwt.invalid_token_loader
def invalid_token_callback(callback):
    return jsonify({'error': 'Invalid token'}), 401

# =========================
# ЗАПУСК ПРИЛОЖЕНИЯ
# =========================
if __name__ == '__main__':
    try:
        Base.metadata.create_all(engine)
        logger.info("Successfully connected to the database and ensured tables exist")
        app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=False)
    except Exception as e:
        logger.error(f"Startup error: {str(e)}\n{traceback.format_exc()}")
        raise
```

### Основные изменения

1. **Логирование**:
   - Заменено `RotatingFileHandler` на `StreamHandler` для вывода логов в `stdout`, что лучше подходит для Render.
   - Улучшены сообщения об ошибках с указанием конкретного действия (например, "Get swaps error" вместо "LOGIN ERROR").
   - Добавлено логирование успешных операций (регистрация, вход, создание запросов и т.д.).

2. **Модель `SwapRequest`**:
   - Добавлен `cascade="all, delete-orphan"` для автоматического удаления запросов при удалении связанных пользователей или смен.
   - Добавлен единый эндпоинт `/api/swaps` для получения всех запросов (входящих и исходящих), как ожидает фронтенд.

3. **Парсинг PDF**:
   - Улучшена функция `parse_pdf_with_colors` для определения дат в первой колонке и разделения имени пользователя и кода смены.
   - Реализована логика сохранения смен в базе данных в эндпоинте `/api/schedule/upload`.
   - Добавлена обработка ошибок при отсутствии пользователя или неверном формате даты.

4. **PWA**:
   - Добавлен маршрут `/sw.js` с заголовком `Service-Worker-Allowed: /` для корректной работы Service Worker.
   - Улучшен маршрут `/<path:path>` для обслуживания `manifest.json` и иконок.
   - Убедитесь, что файлы `sw.js`, `manifest.json`, `icon-192x192.png` и `icon-512x512.png` находятся в папке `static`.

5. **Обновление профиля**:
   - Эндпоинт `/api/profile` теперь поддерживает обновление `full_name`, `email`, `phone` с проверкой уникальности.
   - Добавлена валидация `font_size` (допустимые значения: small, medium, large).

6. **Календарь доступности**:
   - Эндпоинт `/api/availabilities` теперь валидирует значения `slot` и `status`.
   - Добавлена проверка на дублирующиеся записи перед созданием новой.

7. **Сегодняшние смены**:
   - Эндпоинт `/api/today-shifts` дополнен полем `is_coordinator` для отображения статуса координатора на фронтенде.

8. **Удалены неиспользуемые эндпоинты**:
   - Удален `/generate_hash`, так как он не используется во фронтенде.

9. **Render-специфичные настройки**:
   - Используется `os.environ.get('PORT', 5000)` для определения порта.
   - Логирование настроено для вывода в `stdout`, что совместимо с логами Render.
   - Удален `debug=True`, так как он не рекомендуется для продакшена.

10. **Валидация и обработка ошибок**:
    - Добавлена проверка обязательных полей в эндпоинтах (например, `email`, `password`, `full_name` в `/api/register`).
    - Добавлена валидация формата дат и значений (`slot`, `status`, `font_size`).

---

### Инструкции по деплою на Render

1. **Структура проекта**:
   Убедитесь, что структура проекта выглядит так:
   ```
   /project
   ├── app.py
   ├── static/
   │   ├── index.html
   │   ├── sw.js
   │   ├── manifest.json
   │   ├── icons/
   │   │   ├── icon-192x192.png
   │   │   ├── icon-512x512.png
   ├── requirements.txt
   ```

2. **Файл `requirements.txt`**:
   ```
   flask==2.3.3
   flask-jwt-extended==4.5.2
   flask-cors==4.0.0
   sqlalchemy==2.0.20
   pdfplumber==0.10.2
   qrcode==7.4.2
   ```

3. **Переменные окружения на Render**:
   В настройках сервиса на Render задайте:
   - `DATABASE_URL`: URL вашей базы данных (например, PostgreSQL, предоставленный Render).
   - `JWT_SECRET_KEY`: Секретный ключ для JWT (генерируйте безопасный ключ, например, с помощью `openssl rand -hex 32`).
   - `PYTHON_VERSION`: 3.9 или выше (например, 3.11).

4. **Настройка сервиса**:
   - В Render создайте Web Service, выберите Python как среду.
   - Укажите команду запуска: `gunicorn app:app`.
   - Убедитесь, что корневая директория проекта задана правильно (обычно `/`).

5. **Иконки для PWA**:
   - Создайте иконки размером 192x192 и 512x512 пикселей и поместите их в `static/icons/`.
   - Убедитесь, что пути в `manifest.json` соответствуют реальным файлам.

6. **Деплой**:
   - Загрузите проект в репозиторий (GitHub, GitLab, Bitbucket).
   - Подключите репозиторий к Render и выполните деплой.
   - Проверьте логи в консоли Render для диагностики ошибок.

7. **Проверка PWA**:
   - Откройте приложение в браузере и проверьте, появляется ли предложение установить PWA.
   - Убедитесь, что `/sw.js` и `/static/manifest.json` доступны (должны возвращать 200 OK).
   - Проверьте работу оффлайн-режима, открыв приложение без интернета.

8. **База данных**:
   - Если используете PostgreSQL на Render, убедитесь, что `DATABASE_URL` указывает на правильную базу.
   - Выполните `Base.metadata.create_all(engine)` при первом запуске для создания таблиц.

---

### Дополнительные рекомендации

1. **Парсинг PDF**:
   - Функция `parse_pdf_with_colors` предполагает определенный формат PDF (первая колонка — даты, остальные — имена и коды смен). Если ваш PDF имеет другой формат, напишите пример структуры, и я помогу доработать парсер.
   - Например, если PDF содержит таблицу вида:
     ```
     | Дата       | Пользователь | Код смены |
     | 2025-08-20 | Jan Kowalski | 08:00-16:00 |
     ```
     Парсер нужно настроить под эту структуру.

2. **QR-коды**:
   - Если вы хотите интегрировать QR-коды в интерфейс, добавьте в фронтенд отображение QR-кода из эндпоинта `/api/shifts/<shift_id>/qr-code`. Например, добавьте кнопку "Показать QR-код" в `shiftDetailsModal`.

3. **Тестирование**:
   - Протестируйте эндпоинты с помощью Postman или cURL, особенно `/api/swaps`, `/api/availabilities` и `/api/today-shifts`.
   - Проверьте работу PWA в Chrome DevTools (вкладка Application).

4. **Безопасность**:
   - Убедитесь, что `JWT_SECRET_KEY` безопасен и не хранится в репозитории.
   - Для продакшена настройте HTTPS на Render (обычно автоматически включено).

5. **Логирование**:
   - Используйте логи Render для отладки. Если нужно больше функциональности, рассмотрите интеграцию с внешним сервисом логирования (например, Loggly).

---

### Тестирование фронтенда и бэкенда

1. **Локальное тестирование**:
   - Запустите бэкенд локально: `python app.py`.
   - Убедитесь, что фронтенд обращается к `http://localhost:5000/api` (измените `API_BASE_URL` в `index.html` на `http://localhost:5000`).
   - Проверьте авторизацию, загрузку расписания, создание запросов на обмен и обновление доступности.

2. **Тестирование на Render**:
   - После деплоя проверьте, что все эндпоинты доступны по `https://<your-render-url>/api`.
   - Убедитесь, что PWA работает (появляется предложение установить приложение).

---

Если у вас есть дополнительные вопросы или нужна помощь с конкретной частью (например, настройка PDF-парсера под ваш формат или интеграция QR-кодов), напишите, и я помогу! Также, если вы хотите добавить новые функции (например, push-уведомления через FCM), дайте знать.
