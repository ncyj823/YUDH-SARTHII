import React, { useEffect, useRef, useState } from 'react';
import { Zone, Resource } from '../types';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { AlertCircle } from 'lucide-react';

interface MapProps {
  zones: Zone[];
  resources: Resource[];
  onZoneClick?: (zone: Zone) => void;
  onResourceClick?: (resource: Resource) => void;
  onMapClick?: (lat: number, lng: number) => void;
}

const Map: React.FC<MapProps> = ({ zones, resources, onZoneClick, onResourceClick, onMapClick }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const onMapClickRef = useRef(onMapClick);
  const [isTokenMissing, setIsTokenMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  const updateMapData = (map: mapboxgl.Map, currentZones: Zone[], currentResources: Resource[]) => {
    if (!map.isStyleLoaded()) return;

    // 1. Update Zones
    const zoneSourceId = 'zones-source';
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: currentZones.map(zone => ({
        type: 'Feature',
        properties: {
          id: zone.id,
          status: zone.status,
          color: zone.status === 'safe' ? '#10b981' : zone.status === 'warring' ? '#f59e0b' : '#ef4444'
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              ...zone.coordinates.map(c => [c.lng, c.lat]),
              [zone.coordinates[0].lng, zone.coordinates[0].lat]
            ]
          ]
        }
      }))
    };

    const source = map.getSource(zoneSourceId) as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(geojson);
    } else {
      map.addSource(zoneSourceId, {
        type: 'geojson',
        data: geojson
      });

      map.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: zoneSourceId,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.35
        }
      });

      map.addLayer({
        id: 'zone-line',
        type: 'line',
        source: zoneSourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.8
        }
      });
    }

    // 2. Update Resources (Markers)
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    currentResources.forEach(resource => {
      const color = resource.type === 'medical' ? '#ef4444' : resource.type === 'shelter' ? '#3b82f6' : '#f59e0b';
      
      const el = document.createElement('div');
      el.className = 'resource-marker';
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = color;
      el.style.border = '2px solid white';
      el.style.cursor = 'pointer';
      el.style.boxShadow = '0 0 4px rgba(0,0,0,0.5)';

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onResourceClick?.(resource);
      });

      const marker = new mapboxgl.Marker(el)
        .setLngLat([resource.lng, resource.lat])
        .addTo(map);
      
      markersRef.current.push(marker);
    });
  };

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token || token === 'YOUR_MAPBOX_TOKEN' || token.trim() === '') {
      setIsTokenMissing(true);
      return;
    }

    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = token;

    try {
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [77.2090, 28.6139], // New Delhi [lng, lat]
        zoom: 12,
        attributionControl: false
      });

      mapRef.current = map;

      map.on('load', () => {
        updateMapData(map, zones, resources);
      });

      map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['zone-fill'] });
        if (features.length > 0) {
          const zoneId = features[0].properties?.id;
          const zone = zones.find(z => z.id === zoneId);
          if (zone) {
            onZoneClick?.(zone);
            return;
          }
        }
        onMapClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
      });

      map.on('mouseenter', 'zone-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'zone-fill', () => {
        map.getCanvas().style.cursor = '';
      });

      const resizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserver.observe(mapContainerRef.current);

      return () => {
        resizeObserver.disconnect();
        map.remove();
      };
    } catch (err) {
      console.error('Error initializing Mapbox:', err);
      setLoadError('Failed to load Mapbox. Please check your token and internet connection.');
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    
    if (map.isStyleLoaded()) {
      updateMapData(map, zones, resources);
    } else {
      map.once('style.load', () => {
        updateMapData(map, zones, resources);
      });
    }
  }, [zones, resources, onZoneClick, onResourceClick]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full rounded-lg shadow-lg bg-zinc-900 flex items-center justify-center overflow-hidden">
        {(isTokenMissing || loadError) && (
          <div className="max-w-xs text-center p-6 space-y-4 animate-in fade-in duration-500 z-10">
            <div className="inline-flex p-3 bg-red-500/10 rounded-full">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-white uppercase tracking-tight">
                {isTokenMissing ? 'Token Required' : 'Map Load Error'}
              </h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                {isTokenMissing 
                  ? 'Please add your Mapbox Token to the Secrets panel in AI Studio to enable the interactive map.' 
                  : loadError}
              </p>
            </div>
            {isTokenMissing && (
              <div className="text-[10px] font-mono bg-black/40 p-2 rounded border border-white/5 text-zinc-400">
                VITE_MAPBOX_TOKEN
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-black/80 p-3 rounded-lg border border-white/20 text-xs space-y-2 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-emerald-500 rounded-full" />
          <span className="text-white">Safe Zone</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-amber-500 rounded-full" />
          <span className="text-white">Warring Zone</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded-full" />
          <span className="text-white">Dangerous Zone</span>
        </div>
      </div>
    </div>
  );
};

export default Map;
