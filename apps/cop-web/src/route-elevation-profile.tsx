export interface RouteElevationProfileSummary {
  gainM?: number;
  lossM?: number;
  maxM?: number;
  minM?: number;
  points: Array<{
    distanceM: number;
    elevationM: number;
  }>;
}

export function RouteElevationProfileView({ profile }: { profile: RouteElevationProfileSummary }) {
  const width = 240;
  const height = 58;
  const paddingX = 4;
  const paddingY = 5;
  const points = profile.points;
  const minDistance = points[0]?.distanceM ?? 0;
  const maxDistance = points[points.length - 1]?.distanceM ?? minDistance + points.length - 1;
  const minElevation = profile.minM ?? Math.min(...points.map((point) => point.elevationM));
  const maxElevation = profile.maxM ?? Math.max(...points.map((point) => point.elevationM));
  const distanceSpan = Math.max(1, maxDistance - minDistance);
  const elevationSpan = Math.max(1, maxElevation - minElevation);
  const polyline = points
    .map((point, index) => {
      const x =
        paddingX +
        (((Number.isFinite(point.distanceM) ? point.distanceM : index) - minDistance) / distanceSpan) *
          (width - paddingX * 2);
      const y = paddingY + (1 - (point.elevationM - minElevation) / elevationSpan) * (height - paddingY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="map-object-popover-elevation">
      <div>
        <span>Výškový profil</span>
        <strong>
          {Math.round(minElevation)}-{Math.round(maxElevation)} m
        </strong>
      </div>
      <svg aria-hidden="true" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
        <polyline points={polyline} />
      </svg>
      <small>
        {profile.gainM !== undefined ? `Stoupání ${Math.round(profile.gainM)} m` : "Stoupání n/a"}
        {profile.lossM !== undefined ? ` · klesání ${Math.round(profile.lossM)} m` : ""}
      </small>
    </div>
  );
}
