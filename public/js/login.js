// login.js - log the user in and remember them in localStorage

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const data = await postJSON('/api/login', { email, password });
    setUser(data.user); // remember who is logged in
    setToken(data.token); // needed for admin pages
    showMessage('message', 'Login successful! Redirecting...', 'success');

    // If we were sent here from another page (e.g. checkout), go back there.
    // Only simple page names like "checkout.html" are allowed.
    const next = new URLSearchParams(window.location.search).get('next');
    const target = next && /^[a-z-]+\.html(\?id=[0-9a-fA-F]{24})?$/.test(next) ? next : 'index.html';

    setTimeout(() => (window.location.href = target), 1000);
  } catch (err) {
    showMessage('message', err.message, 'error');
  }
});