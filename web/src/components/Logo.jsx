import React from 'react';

export default function Logo({ variant = 'header' }) {
  const isFooter = variant === 'footer';
  const imgHeight = isFooter ? '32px' : '28px';
  
  return (
    <div className={isFooter ? "footer-brand" : "logo"}>
      <img 
        src="/assets/logo.png" 
        alt="Shyoski Logo" 
        style={{ 
          height: imgHeight, 
          width: 'auto', 
          objectFit: 'contain',
          display: 'block'
        }} 
      />
      Shyoski
    </div>
  );
}
