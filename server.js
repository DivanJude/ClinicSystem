require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const ADMIN_PASSWORD = 'admin';
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable.');
  process.exit(1);
}

// MongoDB Connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Define Schemas
const StudentSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: String,
  email: String,
  birthdate: String,
  password: String,
  firstLogin: Boolean,
  picture: String,
  appointments: [String]
});

const StaffSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name: String,
  specialty: String,
  email: String,
  slots: [String]
});

const AppointmentSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  studentId: String,
  staffId: String,
  date: String,
  time: String,
  service: String,
  status: String,
  cancelReason: String,
  approvalDate: String,
  createdAt: { type: Date, default: Date.now }
});

const StaffScheduleSchema = new mongoose.Schema({
  date: String,
  staffId: String,
  slots: [String]
});

// Create Models
const Student = mongoose.model('Student', StudentSchema);
const Staff = mongoose.model('Staff', StaffSchema);
const Appointment = mongoose.model('Appointment', AppointmentSchema);
const StaffSchedule = mongoose.model('StaffSchedule', StaffScheduleSchema);

// Initialize DB from data.json if empty
async function initializeDB() {
  try {
    const studentCount = await Student.countDocuments();
    const staffCount = await Staff.countDocuments();
    
    if (studentCount === 0 && staffCount === 0) {
      const DATA_PATH = path.join(__dirname, 'data.json');
      const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      
      // Seed students
      for (const [id, student] of Object.entries(data.students || {})) {
        await Student.create({
          id,
          ...student,
          appointments: student.appointments || []
        });
      }
      
      // Seed staff
      if (data.staff && Array.isArray(data.staff)) {
        await Staff.insertMany(data.staff);
      }
      
      // Seed appointments
      if (data.appointments && Array.isArray(data.appointments)) {
        await Appointment.insertMany(data.appointments);
      }
      
      // Seed staff schedules
      for (const [date, schedules] of Object.entries(data.staffSchedules || {})) {
        for (const [staffId, slots] of Object.entries(schedules)) {
          await StaffSchedule.create({ date, staffId, slots });
        }
      }
      
      console.log('Database initialized from data.json');
    }
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
}


const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Wait for DB to be ready before starting server
mongoose.connection.once('connected', async () => {
  await initializeDB();
  
  app.get('/api/status', (req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.post('/api/login', async (req, res) => {
    const { id, password } = req.body;
    if (!id || !password) {
      return res.status(400).json({ error: 'Missing id or password' });
    }

    if (id.toLowerCase() === 'admin' && password === ADMIN_PASSWORD) {
      return res.json({ role: 'admin', user: { name: 'Clinic Admin' } });
    }

    try {
      const student = await Student.findOne({ id });
      if (!student || student.password !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      return res.json({
        role: 'student',
        user: {
          id: student.id,
          name: student.name,
          email: student.email,
          birthdate: student.birthdate,
          firstLogin: student.firstLogin,
          picture: student.picture || ''
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/student/:id', async (req, res) => {
    try {
      const student = await Student.findOne({ id: req.params.id });
      if (!student) return res.status(404).json({ error: 'Not found' });
      res.json(student);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.put('/api/student/:id', async (req, res) => {
    try {
      const student = await Student.findOne({ id: req.params.id });
      if (!student) return res.status(404).json({ error: 'Not found' });

      const { name, email, birthdate, password, picture, firstLogin } = req.body;
      if (name) student.name = name;
      if (email) student.email = email;
      if (birthdate) student.birthdate = birthdate;
      if (password !== undefined && password !== null) student.password = password;
      if (typeof firstLogin === 'boolean') student.firstLogin = firstLogin;
      if (picture) student.picture = picture;

      const updated = await student.save();
      console.log(`Updated student ${req.params.id}:`, updated);
      res.json(student);
    } catch (err) {
      console.error('Error updating student:', err);
      res.status(500).json({ error: 'Server error: ' + err.message });
    }
  });

  app.get('/api/students', async (req, res) => {
    try {
      const students = await Student.find();
      res.json(students);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/staff', async (req, res) => {
    try {
      const staff = await Staff.find();
      res.json(staff);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/staff', async (req, res) => {
    try {
      const { name, specialty, email } = req.body;
      if (!name || !specialty || !email) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const staff = await Staff.create({
        id: nanoid(),
        name,
        specialty,
        email,
        slots: []
      });
      res.status(201).json(staff);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.delete('/api/staff/:id', async (req, res) => {
    try {
      const result = await Staff.deleteOne({ id: req.params.id });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/appointments', async (req, res) => {
    try {
      const appointments = await Appointment.find();
      res.json(appointments);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/appointments', async (req, res) => {
    try {
      const { studentId, staffId, date, time, service } = req.body;
      if (!studentId || !staffId || !date || !time || !service) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const appointment = await Appointment.create({
        id: nanoid(),
        studentId,
        staffId,
        date,
        time,
        service,
        status: 'Pending'
      });

      // Add appointment to student's list
      const student = await Student.findOne({ id: studentId });
      if (student) {
        student.appointments.push(appointment.id);
        await student.save();
      }

      res.status(201).json(appointment);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.put('/api/appointments/:id', async (req, res) => {
    try {
      const appointment = await Appointment.findOne({ id: req.params.id });
      if (!appointment) return res.status(404).json({ error: 'Not found' });

      const { status, date, time, staffId, cancelReason, approvalDate } = req.body;
      if (status) appointment.status = status;
      if (date) appointment.date = date;
      if (time) appointment.time = time;
      if (staffId) appointment.staffId = staffId;
      if (cancelReason) appointment.cancelReason = cancelReason;
      if (approvalDate) appointment.approvalDate = approvalDate;

      await appointment.save();
      res.json(appointment);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.delete('/api/appointments/:id', async (req, res) => {
    try {
      const appointment = await Appointment.findOne({ id: req.params.id });
      if (!appointment) return res.status(404).json({ error: 'Not found' });

      await Appointment.deleteOne({ id: req.params.id });

      // Remove from student's appointments list
      const student = await Student.findOne({ id: appointment.studentId });
      if (student) {
        student.appointments = student.appointments.filter(aid => aid !== appointment.id);
        await student.save();
      }

      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/staffSchedules', async (req, res) => {
    try {
      const schedules = await StaffSchedule.find();
      res.json(schedules);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/staffSchedules', async (req, res) => {
    try {
      const { staffId, date, slots } = req.body;
      if (!staffId || !date || !Array.isArray(slots)) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const schedule = await StaffSchedule.create({ date, staffId, slots });
      res.status(201).json(schedule);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/reset-password', async (req, res) => {
    const { id, newPassword } = req.body;

    if (!id || !newPassword) {
      return res.status(400).json({ error: 'Missing id or new password' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
      const student = await Student.findOne({ id });
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      student.password = newPassword;
      student.firstLogin = false;
      const updated = await student.save();
      console.log(`Password reset for student ${id}`);
      console.log('Updated record:', updated);

      return res.json({ message: 'Password reset successfully' });
    } catch (err) {
      console.error('Error resetting password:', err);
      res.status(500).json({ error: 'Server error: ' + err.message });
    }
  });

  // Serve the front-end app
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Clinic System.html'));
  });

  app.listen(PORT, () => {
    console.log(`Clinic backend running on http://localhost:${PORT}`);
  });
});
