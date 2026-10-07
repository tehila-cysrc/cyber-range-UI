import wordmarkWhite from '../../assets/logo-wordmark-white.svg';
import markGreen from '../../assets/logo-mark-green.svg';
import './certificate.css';

const SKILLS = [
  'AI Agent Compromise',
  'C2 Investigation',
  'Identity & Credential Abuse',
  'Hybrid Pivoting',
  'Attack Reconstruction',
  'Containment & Remediation',
];

// Copy is fixed (the approved final version of design 1); only the student's name and the date vary.
export function Certificate({ name, date, ref }: { name: string; date: string; ref?: React.Ref<HTMLDivElement> }) {
  // Long names shrink so they never run into the seal.
  const nameSize = name.length > 30 ? '24pt' : name.length > 22 ? '28pt' : undefined;
  return (
    <div className="cert" ref={ref}>
      <div className="abs frame" />
      <div className="abs corner c-tl" />
      <div className="abs corner c-tr" />
      <div className="abs corner c-bl" />
      <div className="abs corner c-br" />

      <img className="abs logo" src={wordmarkWhite} alt="CySource" />
      <div className="abs meta">
        Advanced SOC Training
        <br />
        <b>Cyber Range</b>
      </div>

      <div className="abs content">
        <div className="label">Certificate of Completion</div>
        <div className="title">
          AI Agent Compromise
          <br />& Hybrid Incident Response
        </div>
        <div className="lead">Presented to</div>
        <div className="name" style={nameSize ? { fontSize: nameSize } : undefined}>
          {name}
        </div>
        <div className="rule" />
        <p className="body">
          For successfully completing an advanced CySource Cyber Range exercise in AI-driven cyber incident investigation
          and response across hybrid Microsoft environments.
        </p>
      </div>

      <div className="abs skills">
        {SKILLS.flatMap((s, i) => (i === 0 ? [<span key={s}>{s}</span>] : [<i key={`d${i}`} />, <span key={s}>{s}</span>]))}
      </div>

      <div className="abs seal" aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <defs>
            <path id="cert-ring" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" />
          </defs>
          <circle cx="100" cy="100" r="96" fill="none" stroke="#53b464" strokeWidth="1" />
          <circle cx="100" cy="100" r="64" fill="none" stroke="#404e5a" strokeWidth="1" />
          <circle cx="100" cy="100" r="92" fill="none" stroke="#404e5a" strokeWidth="0.6" strokeDasharray="1 3" />
          <text fontFamily="PP Mori" fontWeight="600" fontSize="9.2" fill="#9aa6b0">
            <textPath href="#cert-ring" textLength="486" lengthAdjust="spacing">
              VERIFIED · CYSOURCE CYBER RANGE · ADVANCED SOC ·
            </textPath>
          </text>
        </svg>
        <img src={markGreen} alt="" />
      </div>

      <div className="abs sigs">
        <div className="sig">
          <div className="val">Amir Bar-El</div>
          <div className="key">CySource Founder</div>
        </div>
        <div className="sig">
          <div className="val">{date}</div>
          <div className="key">Date</div>
        </div>
      </div>
      <div className="abs status">
        <i />
        Mission Complete
      </div>
    </div>
  );
}
