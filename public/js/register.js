// register.js - send the registration form to the backend

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirm = document.getElementById('confirm').value;

  if (password !== confirm) {
    showMessage('message', 'Passwords do not match', 'error');
    return;
  }

  try {
    await postJSON('/api/register', { name, email, password });
    showMessage('message', 'Registration successful! Redirecting to login...', 'success');
    setTimeout(() => (window.location.href = 'login.html'), 1500);
  } catch (err) {
    showMessage('message', err.message, 'error');
  }
});