'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Try again later.',
});

// --- First-run setup -------------------------------------------------------

router.get('/setup', (req, res) => {
  if (auth.countUsers() > 0) return res.redirect('/login');
  res.render('setup', { title: 'Set up Artifact Keeper', error: null });
});

router.post('/setup', auth.verifyCsrf, (req, res) => {
  if (auth.countUsers() > 0) return res.redirect('/login');
  const { username, password, password2 } = req.body;
  try {
    if (password !== password2) throw new Error('Passwords do not match.');
    const user = auth.createUser(username, password);
    req.session.userId = user.id;
    req.session.flash = { type: 'success', message: 'Admin account created. Welcome!' };
    res.redirect('/');
  } catch (err) {
    res.status(400).render('setup', { title: 'Set up Artifact Keeper', error: err.message });
  }
});

// --- Login / logout --------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  if (auth.countUsers() === 0) return res.redirect('/setup');
  res.render('login', { title: 'Sign in', error: null });
});

router.post('/login', loginLimiter, auth.verifyCsrf, (req, res) => {
  const { username, password } = req.body;
  const user = auth.verifyCredentials(username, password);
  if (!user) {
    return res.status(401).render('login', { title: 'Sign in', error: 'Invalid username or password.' });
  }
  const returnTo = req.session.returnTo || '/';
  // Regenerate the session id on privilege change to prevent fixation.
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).render('login', { title: 'Sign in', error: 'Could not start session.' });
    }
    req.session.userId = user.id;
    res.redirect(returnTo);
  });
});

router.post('/logout', auth.verifyCsrf, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
