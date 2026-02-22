const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// GET STUDENT RESULTS
router.get('/results', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const connection = await pool.getConnection();

    // Get student ID from user ID
    const [students] = await connection.query(
      'SELECT id FROM students WHERE user_id = ?',
      [userId]
    );

    if (students.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Student not found' });
    }

    const studentId = students[0].id;

    // Get exam results
    const [results] = await connection.query(
      `SELECT 
        er.id,
        e.title,
        s.name as subject_name,
        er.total_marks,
        er.obtained_marks,
        er.percentage,
        er.grade,
        er.result_date
       FROM exam_results er
       JOIN exams e ON er.exam_id = e.id
       JOIN subjects s ON e.subject_id = s.id
       WHERE er.student_id = ?
       ORDER BY er.result_date DESC`,
      [studentId]
    );

    // Get average score
    const [avgScore] = await connection.query(
      'SELECT ROUND(AVG(percentage), 2) as average_score FROM exam_results WHERE student_id = ?',
      [studentId]
    );

    connection.release();

    res.json({
      success: true,
      data: {
        averageScore: avgScore[0].average_score || 0,
        totalTests: results.length,
        results
      }
    });

  } catch (err) {
    console.error('Results error:', err);
    res.status(500).json({ error: 'Failed to fetch results', message: err.message });
  }
});

module.exports = router;
