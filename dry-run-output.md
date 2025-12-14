# 🔴 J Star Code Audit

| Score | Verdict | 🚨 Critical | 🔶 High | 🔹 Medium | 🔧 Nitpick |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **15/100** | **REQUEST_CHANGES** | 4 | 2 | 2 | - |

## 📄 src/auth/login.ts

> [!CAUTION]
> **SQL Injection via string interpolation**
> Directly embedding user input in SQL enables attackers to dump or corrupt the entire database.

> [!CAUTION]
> **Plain-text password comparison**
> Storing and comparing plain passwords leaks credentials if the DB is compromised.

> [!WARNING]
> **Missing rate limiting and session management**
> No throttling or token rotation invites brute-force and session fixation attacks.

**🛠️ Recommended Fixes**

- **SQL Injection via string interpolation**: Replace the raw query with a parameterized statement using the db library's placeholder syntax, e.g. db.query('SELECT * FROM users WHERE email = ?', [email])
- **Plain-text password comparison**: Hash incoming passwords with a strong algorithm (bcrypt, scrypt, or argon2) and compare the hash against the stored hash.
- **Missing rate limiting and session management**: Implement rate limiting (e.g. 5 attempts per IP per 15 min) and issue signed JWT or session cookies with expiry.

---

## 📄 src/api/users/route.ts

> [!CAUTION]
> **Passwords leaked in GET response**
> Returning all user columns exposes plaintext passwords to any caller.

> [!CAUTION]
> **Unprotected DELETE with SQL injection**
> No auth check and raw interpolation allow anyone to delete arbitrary users.

### 🔹 Unbounded user fetch in GET
**Category:** PERFORMANCE

Selecting every user without pagination will crash on large tables.

**🛠️ Recommended Fixes**

- **Passwords leaked in GET response**: Explicitly select only safe columns in the query or map the result to exclude sensitive fields before serialising.
- **Unprotected DELETE with SQL injection**: Add middleware to verify admin/session rights and convert the query to use a parameterised statement.
- **Unbounded user fetch in GET**: Add LIMIT and OFFSET parameters and return a paginated response.

---

## 📄 src/features/themes/schemas.ts

### 🔹 Theme schema lacks validation
**Category:** LOGIC

Colours are plain strings; no hex/rgb checks allow malformed values into the DB.

**🛠️ Recommended Fixes**

- **Theme schema lacks validation**: Refine the schema to use z.string().regex(/^#[0-9A-F]{6}$/i) for colour fields.

---

## 📄 src/deprecated.ts

> [!WARNING]
> **Deleted file exposed hardcoded secret**
> Removing the file is good, but ensure the leaked key is revoked in all envs and no references remain.

**🛠️ Recommended Fixes**

- **Deleted file exposed hardcoded secret**: Verify the API_KEY is invalidated in deployment systems and remove any import references.

---

Powered by J Star Sentinel ⚡