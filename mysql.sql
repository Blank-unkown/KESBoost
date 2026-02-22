

-- Set foreign key checks to 0 temporarily to handle circular dependencies
SET FOREIGN_KEY_CHECKS=0;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    user_type ENUM('teacher', 'school', 'student') NOT NULL,
    school_id INT,
    school_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_school (school_id)
);

-- Schools table
CREATE TABLE IF NOT EXISTS schools (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    admin_id INT,
    city VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Classes table
CREATE TABLE IF NOT EXISTS classes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    school_id INT NOT NULL,
    grade_level VARCHAR(50),
    teacher_id INT,
    student_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_school (school_id)
);

-- Students table
CREATE TABLE IF NOT EXISTS students (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    class_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    roll_number VARCHAR(50),
    enrollment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    INDEX idx_class (class_id)
);

-- Subjects table
CREATE TABLE IF NOT EXISTS subjects (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20),
    class_id INT NOT NULL,
    teacher_id INT,
    description TEXT,
    total_marks INT DEFAULT 100,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_class_subject (class_id, id)
);

-- Subject Students (enrollment)
CREATE TABLE IF NOT EXISTS subject_students (
    id INT PRIMARY KEY AUTO_INCREMENT,
    subject_id INT NOT NULL,
    student_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_subject_student (subject_id, student_id),
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    INDEX idx_subject (subject_id),
    INDEX idx_student (student_id)
);

-- Topics table
CREATE TABLE IF NOT EXISTS topics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    subject_id INT NOT NULL,
    topic_name VARCHAR(255) NOT NULL,
    learning_competency TEXT,
    days_allocated INT,
    percentage INT,
    expected_items INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    INDEX idx_subject (subject_id)
);

-- Questions table
CREATE TABLE IF NOT EXISTS questions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    subject_id INT NOT NULL,
    topic_id INT,
    bloom_level ENUM('remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'),
    question_text TEXT NOT NULL,
    option_a VARCHAR(255),
    option_b VARCHAR(255),
    option_c VARCHAR(255),
    option_d VARCHAR(255),
    correct_answer VARCHAR(1),
    marks INT DEFAULT 1,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_subject_topic (subject_id, topic_id)
);

-- Exams table
CREATE TABLE IF NOT EXISTS exams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    class_id INT NOT NULL,
    subject_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    exam_date DATETIME,
    total_marks INT,
    total_questions INT,
    duration_minutes INT,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_class_exam (class_id, exam_date)
);

-- Answer keys table
CREATE TABLE IF NOT EXISTS answer_keys (
    id INT PRIMARY KEY AUTO_INCREMENT,
    exam_id INT NOT NULL,
    question_id INT NOT NULL,
    correct_answer VARCHAR(1),
    marks INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    INDEX idx_exam (exam_id)
);

-- Scanned answer sheets table
CREATE TABLE IF NOT EXISTS scanned_answersheets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    exam_id INT NOT NULL,
    student_id INT,
    scan_date DATETIME NOT NULL,
    header_image_path VARCHAR(255),
    full_image_path VARCHAR(255),
    total_marks INT,
    obtained_marks INT,
    percentage DECIMAL(5, 2),
    status ENUM('processed', 'pending', 'error') DEFAULT 'processed',
    scan_quality_score INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    INDEX idx_exam_date (exam_id, scan_date),
    INDEX idx_student (student_id)
);

-- Student responses table
CREATE TABLE IF NOT EXISTS student_responses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    scanned_sheet_id INT NOT NULL,
    question_id INT NOT NULL,
    student_answer VARCHAR(1),
    is_correct BOOLEAN,
    marks_obtained INT,
    time_taken INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scanned_sheet_id) REFERENCES scanned_answersheets(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    INDEX idx_sheet_question (scanned_sheet_id, question_id)
);

-- Exam results table
CREATE TABLE IF NOT EXISTS exam_results (
    id INT PRIMARY KEY AUTO_INCREMENT,
    exam_id INT NOT NULL,
    student_id INT NOT NULL,
    scanned_sheet_id INT,
    total_marks INT,
    obtained_marks INT,
    percentage DECIMAL(5, 2),
    grade VARCHAR(5),
    attempt_number INT DEFAULT 1,
    result_date DATETIME,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (scanned_sheet_id) REFERENCES scanned_answersheets(id) ON DELETE SET NULL,
    UNIQUE KEY unique_exam_student_attempt (exam_id, student_id, attempt_number),
    INDEX idx_student_results (student_id),
    INDEX idx_exam_results (exam_id)
);

-- Cognitive analysis table
CREATE TABLE IF NOT EXISTS cognitive_analysis (
    id INT PRIMARY KEY AUTO_INCREMENT,
    exam_id INT NOT NULL,
    student_id INT NOT NULL,
    remembering_score INT DEFAULT 0,
    understanding_score INT DEFAULT 0,
    applying_score INT DEFAULT 0,
    analyzing_score INT DEFAULT 0,
    evaluating_score INT DEFAULT 0,
    creating_score INT DEFAULT 0,
    strongest_level VARCHAR(50),
    weakest_level VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    INDEX idx_exam_student (exam_id, student_id)
);

-- Add foreign keys after all tables are created
ALTER TABLE users ADD FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL;
ALTER TABLE schools ADD FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS=1;