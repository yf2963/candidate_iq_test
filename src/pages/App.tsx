export default function App() {
  return (
    <main className="shell">
      <section className="card hero">
        <span className="eyebrow">IQ Test Hiring App</span>
        <h1>Self-hosted candidate screening with one-time links and a hard timer.</h1>
        <p>
          This app generates expiring candidate links, runs a server-timed 50-question test,
          auto-scores results, and gives admins a ranked dashboard.
        </p>
        <div className="actions">
          <a className="button" href="/admin">Open admin</a>
        </div>
      </section>
    </main>
  );
}
