import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ApiError } from './api/client'

/** Sign-in screen shown in live mode until a session exists. */
export default function Login({
  onSignIn,
}: {
  onSignIn: (email: string, password: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await onSignIn(email, password)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark" aria-hidden="true">
          <span>R</span>
          <span>S</span>
        </div>
        <h1>Red Seal Operations</h1>
        <p>Sign in to continue.</p>

        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p role="alert" className="login-error">{error}</p>}

        <button type="submit" className="primary-btn full-btn" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <small><ShieldCheck size={13} /> Every action is audit logged.</small>
      </form>
    </div>
  )
}
