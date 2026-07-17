'use strict';

const express = require('express');
const auth = require('../auth');

const router = express.Router();

// Every route here is admin-only: authenticated first, then admin-gated.
router.use(auth.requireAuth);
router.use(auth.requireAdmin);

router.get('/users', (req, res) => {
  res.render('users', {
    title: 'Users',
    users: auth.listUsers(),
  });
});

router.post('/users', auth.verifyCsrf, (req, res) => {
  const { username, password } = req.body;
  // Default to the least-privileged role unless a valid role is supplied.
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  try {
    auth.createUser(username, password, role);
    req.session.flash = { type: 'success', message: `User "${String(username).trim()}" created.` };
  } catch (err) {
    req.session.flash = { type: 'danger', message: err.message };
  }
  res.redirect('/users');
});

router.post('/users/:id/password', auth.verifyCsrf, (req, res) => {
  try {
    auth.setPassword(req.params.id, req.body.password);
    req.session.flash = { type: 'success', message: 'Password reset.' };
  } catch (err) {
    req.session.flash = { type: 'danger', message: err.message };
  }
  res.redirect('/users');
});

router.post('/users/:id/delete', auth.verifyCsrf, (req, res) => {
  // Never let an admin delete their own account — that could orphan the session
  // and, combined with the last-admin guard, is confusing. Block it up front.
  if (Number(req.params.id) === req.session.userId) {
    req.session.flash = { type: 'danger', message: 'You cannot delete your own account.' };
    return res.redirect('/users');
  }
  try {
    auth.deleteUser(req.params.id);
    req.session.flash = { type: 'success', message: 'User deleted.' };
  } catch (err) {
    req.session.flash = { type: 'danger', message: err.message };
  }
  res.redirect('/users');
});

module.exports = router;
