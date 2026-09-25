import * as React from "react";
import { ArrowRight, RotateCcw, ShieldCheck, Waves } from "lucide-react";
import { CopMap } from "./CopMap";
import type { SituationFeature } from "./cop-data";
import { publicFloodDemoFeatures, publicFloodDemoView, type PublicFloodDemoStep } from "./public-flood-demo-data";
import type { MapViewState } from "./user-preferences";
import "./public-flood-demo.css";

const steps = ["Úvod", "Situace", "Sdělení obce", "Možný přenos", "Výpadek"] as const;
const story = [
  "Mapa COP je připravená. Po spuštění se zobrazí výhradně syntetické situační prvky.",
  "Na skutečném mapovém rendereru COP sledujete modelový rozliv, neprůjezdné místo a shromaždiště. Nejde o živá hlášení.",
  "Fiktivní obec modelově schválila krátký text pro přesně uvedenou oblast a dobu. Vydavatel a poslední ověření zůstávají viditelné.",
  "Schválený stručný text by mohl být předán také přes ARDOS. Žádná integrace ani skutečné doručení zde neprobíhá.",
  "Spojení je modelově přerušené. Poslední text zůstává čitelný, ale aktuální stav není znám a je výslovně označen jako neověřený."
] as const;

export function PublicFloodDemo() {
  const [step, setStep] = React.useState<PublicFloodDemoStep>(0);
  const [selectedFeature, setSelectedFeature] = React.useState<SituationFeature | null>(null);
  const [mapView, setMapView] = React.useState<MapViewState>(publicFloodDemoView);
  const [autoFit, setAutoFit] = React.useState(false);
  const [mapControlsCollapsed, setMapControlsCollapsed] = React.useState(true);
  const [mapLegendCollapsed, setMapLegendCollapsed] = React.useState(false);
  const features = React.useMemo(() => publicFloodDemoFeatures(step), [step]);
  const selectedFeatureId = features.some(
    (feature) => feature.properties.featureId === selectedFeature?.properties.featureId
  )
    ? selectedFeature?.properties.featureId
    : undefined;

  const advance = () => {
    if (step >= 4) return;
    if (step === 0) setAutoFit(true);
    setSelectedFeature(null);
    setStep((current) => Math.min(4, current + 1) as PublicFloodDemoStep);
  };
  const restart = () => {
    setStep(0);
    setSelectedFeature(null);
    setAutoFit(false);
    setMapView(publicFloodDemoView);
  };

  return (
    <main className="public-flood-demo" data-cop-demo="flood-central-bohemia">
      <header className="public-flood-demo-header">
        <div className="public-flood-demo-brand">
          <Waves size={23} aria-hidden="true" /> COP <span>Civilní situační mapa</span>
        </div>
        <div className="public-flood-demo-header-actions">
          <strong className="public-flood-demo-badge">DEMO · SYNTETICKÁ DATA</strong>
          <a href="/">Aktuální COP ↗</a>
        </div>
      </header>

      <div className="public-flood-demo-layout">
        <section className="public-flood-demo-map" aria-label="Skutečná mapa COP se syntetickými prvky">
          <div className="public-flood-demo-map-label">MAPA COP · POUZE SYNTETICKÁ VRSTVA</div>
          <CopMap
            alerts={[]}
            aoiRules={[]}
            clusterTracks={false}
            objects={[]}
            emptyMessage={null}
            hasSituationContextEnabled={step > 0}
            mapLayerDetailLabel="Syntetické prvky"
            mapLayerLabel="Povodňový scénář · DEMO"
            mapControlsCollapsed={mapControlsCollapsed}
            mapLegendCollapsed={mapLegendCollapsed}
            selectedSituationFeatureId={selectedFeatureId}
            showHistory={false}
            showPrediction={false}
            trackHistoryDisplayMode="selected"
            trackHistory={{}}
            mapBasemapMode="civil"
            publicFlightSymbolMode="civil"
            predictionMinutes={0}
            predictionMode="history"
            autoFit={autoFit}
            alertRadiusKm={0}
            focusView={mapView}
            focusViewRequest={0}
            focusUserLocationRequest={0}
            hasProximityAlerts={false}
            initialView={publicFloodDemoView}
            situationFeatures={{ features }}
            sharedLiveLocations={[]}
            onBoundsChange={() => undefined}
            onSelectObject={() => undefined}
            onSelectSituationFeature={setSelectedFeature}
            onAutoFitChange={setAutoFit}
            onMapControlsCollapsedChange={setMapControlsCollapsed}
            onMapLegendCollapsedChange={setMapLegendCollapsed}
            onClearSelection={() => setSelectedFeature(null)}
            onRequestUserLocation={() => undefined}
            onUserLocationFollowChange={() => undefined}
            onViewChange={setMapView}
            showAlertAreas={false}
            showProximityAlertRadius={false}
            userLocation={null}
            userLocationFollowEnabled={false}
          />
        </section>

        <aside className="public-flood-demo-panel" aria-label="Průvodce povodňovým scénářem">
          <div className="public-flood-demo-panel-head">
            <span className="public-flood-demo-kicker">Veřejná ukázka v aplikaci COP</span>
            <h1>Povodňový scénář</h1>
            <p>
              Projděte modelovou situaci přímo na mapě COP. Není potřeba účet; prezentace nevytváří incidenty ani
              nepoužívá živá data SIM.
            </p>
          </div>

          <ol className="public-flood-demo-steps" aria-label="Kroky scénáře">
            {steps.map((label, index) => (
              <li
                className={index === step ? "active" : index < step ? "done" : ""}
                key={label}
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index}</span>
                {label}
              </li>
            ))}
          </ol>

          <div className="public-flood-demo-story" aria-live="polite">
            <h2>{steps[step]}</h2>
            <p>{story[step]}</p>
          </div>

          <div
            className={`public-flood-demo-status ${step === 4 ? "stale" : step >= 2 ? "approved" : "pending"}`}
            role="status"
            aria-live="polite"
          >
            <strong>
              {step === 4
                ? "NEAKTUÁLNĚ OVĚŘENO · VÝPADEK"
                : step >= 2
                  ? "Modelově schválené sdělení"
                  : "Veřejné sdělení zatím nebylo schváleno"}
            </strong>
            <span>
              {step === 4
                ? "Poslední modelové ověření 14:32. Současný stav není znám."
                : step >= 2
                  ? "Modelový čas 14:32 · výhradně syntetický obsah."
                  : "Situační údaje nejsou automaticky pokynem obce."}
            </span>
          </div>

          <section
            className={`public-flood-demo-message ${step < 2 ? "pending" : ""}`}
            aria-labelledby="public-flood-message-title"
          >
            <h2 id="public-flood-message-title">Sdělení pro občana</h2>
            <p>
              {step < 2
                ? "Text se zobrazí po modelovém schválení v kroku 2."
                : "Z důvodu modelové povodně nevstupujte do podjezdu na dolním nábřeží. Přesuňte se mimo vyznačenou oblast a sledujte další sdělení obce."}
            </p>
            <dl>
              <dt>Oblast</dt>
              <dd>Modelové dolní nábřeží u Roztok</dd>
              <dt>Vydavatel</dt>
              <dd>Obecní úřad Vltavská Lhota (fiktivní)</dd>
              <dt>Platnost</dt>
              <dd>Modelový den 14:20–18:00</dd>
              <dt>Ověřeno</dt>
              <dd>{step < 2 ? "—" : "Modelový den 14:32"}</dd>
            </dl>
          </section>

          {selectedFeatureId ? (
            <section className="public-flood-demo-selection" aria-live="polite">
              <h2>Prvek na mapě</h2>
              <strong>{selectedFeature?.properties.label}</strong>
              <p>{selectedFeature?.properties.description}</p>
              <small>Zdroj: syntetická data pouze v prohlížeči</small>
            </section>
          ) : null}

          <section className="public-flood-demo-ardos">
            <h2>
              <ShieldCheck size={18} aria-hidden="true" /> Možný přenos přes ARDOS
            </h2>
            <p>
              {step === 4
                ? "Při modelovém výpadku nelze potvrdit nové doručení žádným kanálem."
                : "ARDOS je pouze příklad kanálu pro schválený stručný text."}{" "}
              Ukázka není napojená na ARDOS a netvrdí partnerství ani skutečné doručení.
            </p>
          </section>

          <div className="public-flood-demo-actions">
            {step < 4 ? (
              <button className="public-flood-demo-primary" onClick={advance} type="button">
                {step === 0 ? "Spustit scénář" : "Další krok"}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            ) : null}
            {step > 0 ? (
              <button className="public-flood-demo-secondary" onClick={restart} type="button">
                <RotateCcw size={16} aria-hidden="true" /> Začít znovu
              </button>
            ) : null}
          </div>

          <p className="public-flood-demo-disclaimer">
            DEMO · SYNTETICKÁ DATA. Polohy jsou modelové; nejde o skutečnou výstrahu, pokyn obce ani hlášení o současném
            stavu. Sledujte oficiální kanály své obce.
          </p>
        </aside>
      </div>
    </main>
  );
}
