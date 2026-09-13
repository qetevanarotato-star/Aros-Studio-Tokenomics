'use client';

import Link from 'next/link';

/**
 * Home = Canva mock 1:1 (EN copy from design).
 * No language switcher, no doors, no residual portal chrome.
 */
export default function HomePage() {
  return (
    <div className="canva-home">
      <header className="canva-nav">
        <Link href="/nodechain">NodeChain</Link>
        <Link href="/login" className="canva-nav-login">
          Login
        </Link>
      </header>

      <div className="canva-body">
        <img
          className="canva-logo"
          src="/brand/ast-logo-dark.png"
          alt="a. Aros Studio Tokenomics"
          width={520}
          height={280}
        />

        <h1 className="canva-h1">
          Institutional valuation,
          <br />
          recorded after confirmed work
        </h1>

        <p className="canva-lead">
          AST records valuations already confirmed by institutions. Digital units appear only after
          Proof of Transaction. <strong>NodeChain</strong> is the source of truth. This site is
          public lookup and the institution edge - it never mints.
        </p>

        <div className="canva-ctas">
          <Link href="/nodechain" className="canva-cta">
            NodeChain journal
          </Link>
          <Link href="/login" className="canva-cta">
            Institution sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}
