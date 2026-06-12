import React from 'react';

export default function Careers() {
  const handleApply = () => {
    alert('Applications can be sent to careers@shyoski.com. Please include your resume and GitHub profile!');
  };

  return (
    <main className="doc-wrapper" style={{ marginBottom: '2rem', maxWidth: '1000px' }}>
      <div className="doc-header">
        <div className="badge">Join the Team</div>
        <h1 style={{ color: '#0f172a' }}>Shape the Future of Stealth AI</h1>
        <p>
          We are building the next generation of unrecordable, context-aware translation and productivity utilities.
          Help us push the boundaries of display architectures and machine learning.
        </p>
      </div>

      {/* Values Section */}
      <div className="grid-3" style={{ marginBottom: '4rem' }}>
        <div className="card">
          <h3>Absolute Privacy</h3>
          <p>
            We believe data ownership is a human right. We build security-first systems that run local filters and
            process audio loops transparently.
          </p>
        </div>
        <div className="card">
          <h3>High Autonomy</h3>
          <p>
            We trust our builders. We don't track hours or manage tasks rigidly; we evaluate execution, clean code,
            and speed of delivery.
          </p>
        </div>
        <div className="card">
          <h3>Extreme Craftsmanship</h3>
          <p>
            Every pixel and hotkey response matters. We are obsessed with sub-millisecond audio rendering and
            completely silent overlays.
          </p>
        </div>
      </div>

      <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '1.5rem', textAlign: 'center', color: '#0f172a' }}>
        Open Positions
      </h2>
      
      {/* Job Openings Grid */}
      <div className="jobs-grid">
        <div className="job-card">
          <div className="job-info">
            <h3>Senior Electron & Display Systems Engineer</h3>
            <div className="job-meta">
              <span className="job-tag">Engineering</span>
              <span className="job-tag">Full-Time</span>
              <span className="job-tag">Remote</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleApply}>
            Apply Now
          </button>
        </div>

        <div className="job-card">
          <div className="job-info">
            <h3>AI Systems Research Scientist (Audio & NLP)</h3>
            <div className="job-meta">
              <span className="job-tag">R&D</span>
              <span className="job-tag">Full-Time</span>
              <span className="job-tag">Hybrid (Bengaluru)</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleApply}>
            Apply Now
          </button>
        </div>

        <div className="job-card">
          <div className="job-info">
            <h3>Developer Relations & Technical Advocate</h3>
            <div className="job-meta">
              <span className="job-tag">Marketing</span>
              <span className="job-tag">Contract</span>
              <span className="job-tag">Remote</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleApply}>
            Apply Now
          </button>
        </div>
      </div>
    </main>
  );
}
