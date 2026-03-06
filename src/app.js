const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth/authRoutes');
const postRoutes = require('./routes/feed/postRoutes');
const followRoutes = require('./routes/social/followRoutes');
const spaceRoutes = require('./routes/spaces/spaceRoutes');
const profileRoutes = require('./routes/profiles/profileRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'LogoutDev backend is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/users', followRoutes);
app.use('/api/spaces', spaceRoutes);
app.use('/api/profiles', profileRoutes);

module.exports = app;