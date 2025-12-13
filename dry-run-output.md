# 🔴 J Star Code Audit

| Score | Verdict | 🚨 Critical | 🔶 High | 🔹 Medium | 🔧 Nitpick |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **15/100** | **REQUEST_CHANGES** | 4 | 1 | - | - |

## 📄 src/auth/login.ts

> [!CAUTION]
> **SQL Injection in login query**
> String interpolation in SQL query allows attackers to inject arbitrary SQL, bypassing authentication or dumping the database.

> [!CAUTION]
> **Plain-text password storage**
> Comparing plain-text passwords means credentials are stored unhashed; a DB breach exposes every account.

> [!WARNING]
> **Missing rate limiting on login**
> No rate limiting enables brute-force attacks against any account.

**🛠️ Recommended Fixes**

- **SQL Injection in login query**: Replace the raw string interpolation with parameterized queries using your database library's prepared statement API. Example: await db.query('SELECT * FROM users WHERE email = ?', [email])
- **Plain-text password storage**: Hash passwords with a slow algorithm like bcrypt (cost 12+) before storage and compare hashes, never plain text.
- **Missing rate limiting on login**: Implement rate limiting middleware (e.g., 5 attempts per IP per 15 minutes) and increment counters in Redis or DB before processing login.

---

## 📄 src/api/users/route.ts

> [!CAUTION]
> **Passwords leaked in user list**
> Returning all user rows includes password hashes, exposing every credential to any caller.

> [!CAUTION]
> **Authorization bypass in DELETE**
> No ownership or role check allows any client to delete arbitrary users by ID.

**🛠️ Recommended Fixes**

- **Passwords leaked in user list**: Explicitly select only safe columns: SELECT id, name, email FROM users, or map the result to exclude password before JSON encoding.
- **Authorization bypass in DELETE**: Add middleware that validates the requester's session and ensures only admins or the account owner can delete, then use parameterized DELETE.

---

Powered by J Star Sentinel ⚡