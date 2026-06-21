import React from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState
} from "@tanstack/react-table";
import clsx from "clsx";
import type { CopObject } from "./cop-data";
import { getAffiliationPresentation } from "./symbology";

export interface TrackTableProps {
  objects: CopObject[];
  selectedObjectId?: string;
  onSelect: (objectId: string) => void;
}

const objectColumnHelper = createColumnHelper<CopObject>();

export default function TrackTable({ objects, selectedObjectId, onSelect }: TrackTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const columns = React.useMemo(
    () => [
      objectColumnHelper.accessor((object) => formatObjectListLabel(object), {
        id: "label",
        header: "ID",
        cell: (info) => info.getValue()
      }),
      objectColumnHelper.accessor("objectType", {
        header: "Typ",
        cell: (info) => info.getValue()
      }),
      objectColumnHelper.accessor("affiliation", {
        header: "Vztah",
        cell: ({ row }) => {
          const affiliation = getAffiliationPresentation(row.original.affiliation);
          return (
            <>
              <i className={`affiliation-dot ${affiliation.disposition}`} />
              {affiliation.label}
            </>
          );
        }
      }),
      objectColumnHelper.accessor((object) => Math.round((object.confidence ?? 0) * 100), {
        id: "confidence",
        header: "Jistota",
        cell: (info) => `${info.getValue()} %`
      })
    ],
    []
  );
  const table = useReactTable({
    columns,
    data: objects,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (object) => object.objectId,
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting }
  });

  if (objects.length === 0) {
    return <div className="empty-state compact">Žádné objekty neodpovídají aktivním filtrům.</div>;
  }

  return (
    <div className="track-table" role="table" aria-label="Seznam situačních objektů">
      {table.getHeaderGroups().map((headerGroup) => (
        <div className="track-table-head" key={headerGroup.id} role="row">
          {headerGroup.headers.map((header) => {
            const sortState = header.column.getIsSorted();
            const sortLabel = sortState === "asc" ? "vzestupně" : sortState === "desc" ? "sestupně" : "bez řazení";
            const ariaSort = sortState === "asc" ? "ascending" : sortState === "desc" ? "descending" : "none";
            const label = flexRender(header.column.columnDef.header, header.getContext());
            return (
              <span aria-sort={ariaSort} key={header.id} role="columnheader" title={`Řazení: ${sortLabel}`}>
                <button
                  aria-label={`Seřadit podle sloupce ${header.column.id}`}
                  className={clsx("track-table-sort inline-flex items-center gap-1", sortState && "active")}
                  disabled={!header.column.getCanSort()}
                  onClick={header.column.getToggleSortingHandler()}
                  type="button"
                >
                  <span>{label}</span>
                  <span aria-hidden="true" className="track-table-sort-indicator">
                    {sortState === "asc" ? "↑" : sortState === "desc" ? "↓" : "↕"}
                  </span>
                </button>
              </span>
            );
          })}
        </div>
      ))}
      {table.getRowModel().rows.slice(0, 10).map((row) => {
        const object = row.original;
        return (
          <button
            className={clsx("track-row", object.objectId === selectedObjectId && "selected")}
            key={object.objectId}
            onClick={() => onSelect(object.objectId)}
            aria-selected={object.objectId === selectedObjectId}
            role="row"
            type="button"
          >
            {row.getVisibleCells().map((cell) => (
              <span key={cell.id} title={cell.column.id === "label" ? object.objectId : undefined}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}

function formatObjectListLabel(object: CopObject): string {
  const flightData = object.attributes?.flightData;
  const callsign = cleanTrackLabel(flightData?.callsign);
  if (callsign) {
    return callsign;
  }

  const registration = cleanTrackLabel(flightData?.registration);
  if (registration) {
    return registration;
  }

  const icao24 = cleanTrackLabel(flightData?.icao24);
  if (icao24) {
    return icao24.toUpperCase();
  }

  return object.objectId;
}

function cleanTrackLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}
