import { useState } from "react";

interface ModIconProps {
  iconUrl: string | null | undefined;
  modName: string;
}

/**
 * Mod list icon with graceful degradation: missing URLs and broken images
 * (remote hotlink failures, corrupt data) fall back to a neutral placeholder
 * instead of a broken-image glyph.
 */
function ModIcon({ iconUrl, modName }: ModIconProps): React.JSX.Element {
  const [imgError, setImgError] = useState(false);

  if (!iconUrl || imgError) {
    return (
      <div
        title={
          iconUrl
            ? `Icon failed to load for ${modName}`
            : `No icon for ${modName}`
        }
        className="flex shrink-0 items-center justify-center rounded border border-gray-300 bg-gray-100 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500"
        style={{
          width: "var(--app-icon-size, 20px)",
          height: "var(--app-icon-size, 20px)",
          fontSize: "calc(var(--app-icon-size, 20px) * 0.65)",
        }}
      >
        📦
      </div>
    );
  }

  return (
    <img
      src={iconUrl}
      onError={() => setImgError(true)}
      className="shrink-0 rounded border border-gray-200 object-contain dark:border-gray-700"
      style={{
        width: "var(--app-icon-size, 20px)",
        height: "var(--app-icon-size, 20px)",
      }}
      alt=""
    />
  );
}

export default ModIcon;
