const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth/authRoutes');
const accessTokenRoutes = require('./routes/auth/accessTokenRoutes');
const postRoutes = require('./routes/feed/postRoutes');
const hashtagRoutes = require('./routes/feed/hashtagRoutes');
const followRoutes = require('./routes/social/followRoutes');
const spaceRoutes = require('./routes/spaces/spaceRoutes');
const profileRoutes = require('./routes/profiles/profileRoutes');
const gitRoutes = require('./routes/git/gitRoutes');
const questionRoutes = require('./routes/questions/questionRoutes');
const launchRoutes = require('./routes/launches/launchRoutes');
const freelanceRoutes = require('./routes/freelance/freelanceRoutes');
const freelanceMeRoutes = require('./routes/freelance/freelanceMeRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'LogoutDev backend is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users/me/access-tokens', accessTokenRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/hashtags', hashtagRoutes);
app.use('/api/users', followRoutes);
app.use('/api/spaces', spaceRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/launches', launchRoutes);
app.use('/api/freelance', freelanceRoutes);
app.use('/api/users/me/freelance', freelanceMeRoutes);
app.use('/git', gitRoutes);

module.exports = app;
