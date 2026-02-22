# Running the Application

This application has a frontend (Ionic/Angular) and a backend (Express.js/Node.js).

## Frontend (Ionic/Angular)

```bash
npm start
```

This starts the Angular dev server on `http://localhost:4200`

## Backend (Express.js)

Navigate to the `backend` directory:

```bash
cd backend
npm install
npm start
```

The backend server runs on `http://localhost:3000`

## Database Setup

1. Create the MySQL database using the provided SQL file:
   - Open MySQL command line or MySQL Workbench
   - Run: `mysql.sql` (execute all queries)
   - This creates the `exam_scanner` database with all required tables

2. Update `.env` file in the `backend` folder with your MySQL credentials if needed:
   ```
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=exam_scanner
   ```

## Architecture

```
Frontend (Ionic/Angular) 
   ↓
HTTP Requests (localhost:4200)
   ↓
Backend API (Express.js)
   ↓
MySQL Database
```

## Key Features

✅ **Authentication**: Register/Login with JWT tokens
✅ **Teacher Dashboard**: Role-based with sidebar navigation
✅ **Student Dashboard**: Personal results and performance tracking
✅ **Database Integration**: All user data saved to MySQL
✅ **User-Specific Data**: Each user sees their own dashboard data

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Teacher
- `GET /api/teacher/dashboard` - Get teacher dashboard data
- `GET /api/teacher/classes` - Get teacher's classes
- `GET /api/teacher/subjects/:classId` - Get class subjects

### Student
- `GET /api/student/results` - Get student exam results

## Troubleshooting

### Backend won't connect to MySQL
- Ensure MySQL is running (check XAMPP Control Panel)
- Verify database credentials in `.env`
- Check that `exam_scanner` database exists

### Frontend won't connect to backend
- Ensure backend is running on port 3000
- Check CORS is enabled in `backend/server.js`
- Verify API URLs in services (should be `http://localhost:3000/api`)

### Port Already in Use
- Frontend: Change port with `ng serve --port 4300`
- Backend: Change PORT in `.env` file
