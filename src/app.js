const express = require('express');
const cors = require('cors');
const requestLogger = require('./middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const discoveryRoutes = require('./routes/discovery/discoveryRoutes');
const authRoutes = require('./routes/auth/authRoutes');
const accessTokenRoutes = require('./routes/auth/accessTokenRoutes');
const postRoutes = require('./routes/feed/postRoutes');
const hashtagRoutes = require('./routes/feed/hashtagRoutes');
const followRoutes = require('./routes/social/followRoutes');
const notificationRoutes = require('./routes/notifications/notificationRoutes');
const spaceRoutes = require('./routes/spaces/spaceRoutes');
const repoRoutes = require('./routes/repos/repoRoutes');
const profileRoutes = require('./routes/profiles/profileRoutes');
const gitRoutes = require('./routes/git/gitRoutes');
const questionRoutes = require('./routes/questions/questionRoutes');
const launchRoutes = require('./routes/launches/launchRoutes');
const freelanceRoutes = require('./routes/freelance/freelanceRoutes');
const freelanceMeRoutes = require('./routes/freelance/freelanceMeRoutes');
const internalRepoRoutes = require('./routes/internal/internalRepoRoutes');

const app = express();

app.use(requestLogger);
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'LogoutDev backend is running' });
});

app.use('/api/discovery', discoveryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users/me/access-tokens', accessTokenRoutes);
app.use('/api/users/me/notifications', notificationRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/hashtags', hashtagRoutes);
app.use('/api/users', followRoutes);
app.use('/api/spaces', spaceRoutes);
app.use('/api/repos', repoRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/launches', launchRoutes);
app.use('/api/freelance', freelanceRoutes);
app.use('/api/users/me/freelance', freelanceMeRoutes);
app.use('/git', gitRoutes);
app.use('/internal', internalRepoRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
