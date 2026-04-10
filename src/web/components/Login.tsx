export default function Login() {
  return (
    <div className="login-screen">
      <img src="/todos.png" alt="Todos" className="login-logo" />
      <h1>Todos</h1>
      <p>Simple todo lists for AI tasks.</p>
      <a
        href="/auth/login"
        className="btn"
        style={{
          display: "inline-block",
          textAlign: "center",
          textDecoration: "none",
        }}
      >
        Login with Legendum
      </a>
    </div>
  );
}
