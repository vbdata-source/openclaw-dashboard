// ============================================================
// SettingsSection — Card wrapper for settings groups
// ============================================================

import React from "react";

interface SettingsSectionProps {
  title: string;
  icon?: string;
  description?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  badge?: string | number;
  badgeColor?: string;
  className?: string;
}

export function SettingsSection({
  title,
  icon,
  description,
  children,
  collapsible = false,
  defaultCollapsed = false,
  badge,
  badgeColor,
  className = "",
}: SettingsSectionProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  return (
    <div className={`oc-settings-section ${collapsed ? "oc-settings-section--collapsed" : ""} ${className}`}>
      <div
        className={`oc-settings-section__header ${collapsible ? "oc-settings-section__header--clickable" : ""}`}
        onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
      >
        <div className="oc-settings-section__title">
          {icon && <span className="oc-settings-section__icon">{icon}</span>}
          <span>{title}</span>
          {badge !== undefined && (
            <span
              className="oc-settings-section__badge"
              style={badgeColor ? { background: badgeColor } : undefined}
            >
              {badge}
            </span>
          )}
        </div>
        {collapsible && (
          <span className="oc-settings-section__chevron">
            {collapsed ? "▸" : "▾"}
          </span>
        )}
      </div>
      {description && !collapsed && (
        <p className="oc-settings-section__desc">{description}</p>
      )}
      {!collapsed && (
        <div className="oc-settings-section__body">
          {children}
        </div>
      )}
    </div>
  );
}
