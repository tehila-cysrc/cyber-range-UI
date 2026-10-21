import wordmarkWhite from '../../assets/logo-wordmark-white.svg';
import markGreen from '../../assets/logo-mark-green.svg';
import './certificate.css';

// The printed text of a certificate — one entry of the certificate library (server
// certificateTemplates.service.ts; a scenario picks which one it awards). The design itself is fixed.
export interface CertificateTemplate {
  id: number;
  name: string;
  label: string;
  /** Up to two lines, separated by "\n". */
  title: string;
  body: string;
  skills: string[];
  program: string;
  programHighlight: string;
  signerName: string;
  signerTitle: string;
  statusText: string;
  isDefault: boolean;
}

// Design 1 (docs/brand/certificates); the template supplies the copy, the student's name and the date vary.
export function Certificate({
  name,
  date,
  template,
  ref,
}: {
  name: string;
  date: string;
  template: CertificateTemplate;
  ref?: React.Ref<HTMLDivElement>;
}) {
  // Long names shrink so they never run into the seal.
  const nameSize = name.length > 30 ? '24pt' : name.length > 22 ? '28pt' : undefined;
  const titleLines = template.title.split('\n');
  return (
    <div className="cert" ref={ref}>
      <div className="abs frame" />
      <div className="abs corner c-tl" />
      <div className="abs corner c-tr" />
      <div className="abs corner c-bl" />
      <div className="abs corner c-br" />

      <img className="abs logo" src={wordmarkWhite} alt="CySource" />
      <div className="abs meta">
        {template.program}
        <br />
        <b>{template.programHighlight}</b>
      </div>

      <div className="abs content">
        <div className="label">{template.label}</div>
        <div className="title">
          {titleLines.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line}
            </span>
          ))}
        </div>
        <div className="lead">Presented to</div>
        <div className="name" style={nameSize ? { fontSize: nameSize } : undefined}>
          {name}
        </div>
        <div className="rule" />
        <p className="body">{template.body}</p>
      </div>

      {template.skills.length > 0 && (
        <div className="abs skills" style={template.skills.length < 4 ? { justifyContent: 'center', gap: '8mm' } : undefined}>
          {template.skills.flatMap((s, i) =>
            i === 0 ? [<span key={`s${i}`}>{s}</span>] : [<i key={`d${i}`} />, <span key={`s${i}`}>{s}</span>],
          )}
        </div>
      )}

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
          <div className="val">{template.signerName}</div>
          <div className="key">{template.signerTitle}</div>
        </div>
        <div className="sig">
          <div className="val">{date}</div>
          <div className="key">Date</div>
        </div>
      </div>
      <div className="abs status">
        <i />
        {template.statusText}
      </div>
    </div>
  );
}
