# 🔴 J Star Code Audit

| Score | Verdict | 🚨 Critical | 🔶 High | 🔹 Medium | 🔧 Nitpick |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **15/100** | **REQUEST_CHANGES** | 4 | 2 | - | - |

## 📄 src/auth/login.ts

> [!CAUTION]
> **SQL Injection via String Interpolation**
> The SQL query directly interpolates user input, allowing attackers to inject arbitrary SQL and dump or delete data.

> [!CAUTION]
> **Plain-Text Password Comparison**
> Passwords are compared in plain text, exposing credentials to anyone with DB access and violating OWASP guidelines.

> [!WARNING]
> **Missing Rate Limiting and Session Handling**
> No rate limiting or secure session management opens the door to brute-force attacks.

**🛠️ Recommended Fixes**

- **SQL Injection via String Interpolation**: Use parameterized queries: await db.query('SELECT * FROM users WHERE email = ?', [email])
- **Plain-Text Password Comparison**: Install bcrypt: npm i bcrypt. Hash incoming password with bcrypt.compare(password, user.hashedPassword)
- **Missing Rate Limiting and Session Handling**: Add express-rate-limit or similar, issue signed JWT or session cookie with httpOnly and secure flags

---

## 📄 src/api/users/route.ts

> [!CAUTION]
> **Passwords Returned in GET Response**
> The endpoint returns full user objects including passwords, exposing secrets to any caller.

> [!CAUTION]
> **Missing Authorization on DELETE**
> Anyone can delete users by ID without authentication or permission checks.

> [!WARNING]
> **SQL Injection in DELETE via String Interpolation**
> User-supplied id is concatenated into SQL, allowing injection and data loss.

**🛠️ Recommended Fixes**

- **Passwords Returned in GET Response**: Select only safe fields: db.query('SELECT id, name, email FROM users')
- **Missing Authorization on DELETE**: Add auth middleware that validates JWT and checks role-based access before allowing DELETE
- **SQL Injection in DELETE via String Interpolation**: Use parameterized query: await db.query('DELETE FROM users WHERE id = ?', [id])

---

Powered by J Star Sentinel ⚡