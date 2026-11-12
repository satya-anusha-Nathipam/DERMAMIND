/* MODAL CONTROL */
function openModal(id){
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(){
  document.querySelectorAll('.modal, .modal-overlay')
    .forEach(m => m.style.display = 'none');
  document.body.style.overflow = '';
}

// Close modal when clicking outside
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    closeModal();
  }
});

// Close modal with Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeModal();
  }
});

/* SIGNUP — now backed by the DERMAMIND server (SQLite users table),
   not browser localStorage. Passwords are hashed server-side and never
   stored or transmitted in plain form beyond this initial request. */
async function signup(){
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const pass = document.getElementById("signupPass").value;

  if(!name || !email || !pass){
    alert("Please fill in all fields");
    return;
  }

  // Basic email validation (server re-validates too)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert("Please enter a valid email address");
    return;
  }

  // Password validation (server re-validates too)
  if (pass.length < 6) {
    alert("Password must be at least 6 characters");
    return;
  }

  const signupBtn = document.querySelector('#signupModal button[type="submit"]');
  if (signupBtn) signupBtn.disabled = true;

  try {
    await DermaMindAPI.signup(name, email, pass);

    alert("Account created successfully! Please login to continue.");

    // Clear form
    document.getElementById("signupName").value = "";
    document.getElementById("signupEmail").value = "";
    document.getElementById("signupPass").value = "";

    // The signup call already logs the account in (server returns a
    // session token), but we route through the login modal to keep the
    // existing UX flow unchanged.
    DermaMindAPI.clearToken();
    closeModal();
    openModal('loginModal');
  } catch (error) {
    alert(error.message || "Could not create the account. Please try again.");
  } finally {
    if (signupBtn) signupBtn.disabled = false;
  }
}

/* LOGIN */
async function login(){
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;

  if(!email || !pass){
    alert("Please enter your email and password");
    return;
  }

  const loginBtn = document.querySelector('#loginModal button[type="submit"]');
  if (loginBtn) loginBtn.disabled = true;

  try {
    const user = await DermaMindAPI.login(email, pass);
    // Cache the (non-sensitive) user object locally so the rest of the app's
    // existing synchronous reads (getLoggedUserObject/loggedUser) keep working
    // without a rewrite; the DermaMindAPI token is the real source of truth.
    localStorage.setItem("loggedUser", JSON.stringify(user));
    window.location.href = "index.html";
  } catch (error) {
    alert(error.message || "Invalid email or password. Please try again.");
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}

/* LOGOUT */
function logout(){
  if (confirm("Are you sure you want to logout?")) {
    DermaMindAPI.clearToken();
    localStorage.removeItem("loggedUser");
    window.location.href = "home.html";
  }
}
