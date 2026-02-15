// ============================================================
// SensitiveInput — Password field with show/hide toggle
// ============================================================

import React, { useState } from "react";

interface SensitiveInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SensitiveInput({
  value,
  onChange,
  placeholder = "••••••••••••",
  disabled = false,
  className = "",
}: SensitiveInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`oc-sensitive-input ${className}`}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="oc-sensitive-input__field"
        autoComplete="off"
      />
      <button
        type="button"
        className="oc-sensitive-input__toggle"
        onClick={() => setVisible(!visible)}
        title={visible ? "Verbergen" : "Anzeigen"}
        disabled={disabled}
      >
        {visible ? "🙈" : "👁️"}
      </button>
    </div>
  );
}
