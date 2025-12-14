# 🔴 J Star Code Audit

| Score | Verdict | 🚨 Critical | 🔶 High | 🔹 Medium | 🔧 Nitpick |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **15/100** | **REQUEST_CHANGES** | 3 | 2 | - | - |

## 📄 src/auth/login.ts

> [!CAUTION]
> **SQL Injection via string interpolation**
> Email is interpolated directly into SQL, allowing injection. This will leak or destroy data.

> [!WARNING]
> **Plaintext password comparison**
> Passwords stored and compared in plaintext; a breach reveals every credential.

> [!WARNING]
> **No rate limiting or session handling**
> Brute-force attacks are trivial and users receive no secure session.

**🛠️ Recommended Fixes**

- **SQL Injection via string interpolation**: Replace the raw string interpolation with a parameterized query: `await db.query('SELECT * FROM users WHERE email = ?', [email])`
- **Plaintext password comparison**: Hash passwords with bcrypt (10+ rounds) on registration and compare hashes here.
- **No rate limiting or session handling**: Implement rate-limiting middleware and issue signed JWT or session cookie with expiry.

---

## 📄 src/api/users/route.ts

> [!CAUTION]
> **Passwords exposed in GET /users**
> Endpoint returns all columns including plaintext passwords to any caller.

> [!CAUTION]
> **Missing authorization on DELETE**
> Any request can delete any user; no auth, no ownership check.

**🛠️ Recommended Fixes**

- **Passwords exposed in GET /users**: Select only safe columns: `SELECT id, name, email FROM users` and never return passwords.
- **Missing authorization on DELETE**: Add middleware that verifies the caller is authenticated and has admin role before executing the DELETE.

---

Powered by J Star Sentinel ⚡