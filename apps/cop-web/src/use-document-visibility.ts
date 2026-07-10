import React from "react";

function readDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = React.useState(readDocumentVisible);
  React.useEffect(() => {
    const handleVisibilityChange = () => setVisible(readDocumentVisible());
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);
  return visible;
}
