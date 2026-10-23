#!/bin/sh
set -eu
sdk_root=${1:?Pass the candidate CSMCommunicationKit directory after applying sdk.patch}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fixture=${2:-"$script_dir/../../../api/examples/user-selected-arrival-v1.fixture.json"}
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/cop-arrival-proof.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
xcrun swiftc -swift-version 6 -module-cache-path "$work_dir/module-cache" \
  "$script_dir/Support.swift" \
  "$sdk_root/Sources/CSMCommunicationKit/CSMDriverRouting.swift" \
  "$sdk_root/Sources/CSMCommunicationKit/CSMRoadTrip.swift" \
  "$sdk_root/Sources/CSMCommunicationKit/CSMMappedVehicleProfile.swift" \
  "$sdk_root/Sources/CSMCommunicationKit/CSMKnownClosures.swift" \
  "$sdk_root/Sources/CSMCommunicationKit/CSMUserSelectedArrival.swift" \
  "$script_dir/main.swift" -o "$work_dir/arrival-proof-tests"
"$work_dir/arrival-proof-tests" "$fixture"
