export interface WeatherWaypoint {
  lat: number;
  lon: number;
  name: string;
  windSpeed: number;
  windDirection: number;
  waveHeight: number;
  currentSpeed: number;
  currentDirection: number;
  visibility: number;
  weatherCondition: string;
  warning?: string;
}

export interface RouteWeather {
  routeId: string;
  from: string;
  to: string;
  totalDistance: number;
  waypoints: WeatherWaypoint[];
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  recommendations: string[];
}

export const MOCK_WEATHER_ROUTES: RouteWeather[] = [
  {
    routeId: 'route-sg-fuj',
    from: 'Singapore',
    to: 'Fujairah',
    totalDistance: 3820,
    overallRisk: 'HIGH',
    recommendations: [
      'Consider routing south of Sri Lanka to avoid storm system',
      'Reduce speed to 12 knots in area around waypoint 4 (near Sri Lanka) for safety',
      'Monitor GMDSS weather broadcasts every 4 hours',
      'Expect 6-8 hour delay if taking southern deviation',
    ],
    waypoints: [
      {
        lat: 1.26,
        lon: 103.82,
        name: 'Singapore (Departure)',
        windSpeed: 8,
        windDirection: 180,
        waveHeight: 0.5,
        currentSpeed: 0.8,
        currentDirection: 220,
        visibility: 12,
        weatherCondition: 'Clear',
      },
      {
        lat: 1.5,
        lon: 100.5,
        name: 'Strait of Malacca (North)',
        windSpeed: 12,
        windDirection: 200,
        waveHeight: 0.8,
        currentSpeed: 1.2,
        currentDirection: 315,
        visibility: 10,
        weatherCondition: 'Partly Cloudy',
      },
      {
        lat: 5.0,
        lon: 97.0,
        name: 'Andaman Sea',
        windSpeed: 18,
        windDirection: 225,
        waveHeight: 1.8,
        currentSpeed: 0.5,
        currentDirection: 270,
        visibility: 8,
        weatherCondition: 'Overcast',
      },
      {
        lat: 7.5,
        lon: 83.5,
        name: 'Near Sri Lanka - STORM WARNING',
        windSpeed: 42,
        windDirection: 245,
        waveHeight: 4.2,
        currentSpeed: 1.8,
        currentDirection: 300,
        visibility: 3,
        weatherCondition: 'Tropical Storm',
        warning: 'TROPICAL STORM ACTIVE - Beaufort Force 8-9. Recommend southern deviation via 3°N, 78°E. Expect significant vessel motion and potential cargo shifting.',
      },
      {
        lat: 5.0,
        lon: 73.0,
        name: 'Indian Ocean (Mid)',
        windSpeed: 22,
        windDirection: 260,
        waveHeight: 2.1,
        currentSpeed: 0.6,
        currentDirection: 270,
        visibility: 7,
        weatherCondition: 'Rough Sea',
      },
      {
        lat: 12.0,
        lon: 58.0,
        name: 'Arabian Sea Approach',
        windSpeed: 15,
        windDirection: 280,
        waveHeight: 1.2,
        currentSpeed: 0.4,
        currentDirection: 180,
        visibility: 10,
        weatherCondition: 'Partly Cloudy',
      },
      {
        lat: 25.12,
        lon: 56.33,
        name: 'Fujairah (Arrival)',
        windSpeed: 10,
        windDirection: 315,
        waveHeight: 0.6,
        currentSpeed: 0.3,
        currentDirection: 90,
        visibility: 15,
        weatherCondition: 'Clear',
      },
    ],
  },
  {
    routeId: 'route-ktn-sg',
    from: 'Kerteh Marine Terminal',
    to: 'Singapore',
    totalDistance: 380,
    overallRisk: 'LOW',
    recommendations: [
      'Standard coastal route is safe and optimal',
      'Monitor northeast monsoon conditions in South China Sea',
      'Tidal current favourable for departure 0600-0800 local time',
    ],
    waypoints: [
      {
        lat: 4.49,
        lon: 103.42,
        name: 'Kerteh (Departure)',
        windSpeed: 10,
        windDirection: 30,
        waveHeight: 0.6,
        currentSpeed: 0.5,
        currentDirection: 180,
        visibility: 12,
        weatherCondition: 'Clear',
      },
      {
        lat: 3.5,
        lon: 103.8,
        name: 'South China Sea (Mid)',
        windSpeed: 14,
        windDirection: 45,
        waveHeight: 1.0,
        currentSpeed: 0.8,
        currentDirection: 195,
        visibility: 10,
        weatherCondition: 'Partly Cloudy',
      },
      {
        lat: 2.2,
        lon: 104.0,
        name: 'Singapore Straits Approach',
        windSpeed: 8,
        windDirection: 90,
        waveHeight: 0.4,
        currentSpeed: 1.5,
        currentDirection: 270,
        visibility: 12,
        weatherCondition: 'Hazy',
      },
      {
        lat: 1.26,
        lon: 103.82,
        name: 'Singapore (Arrival)',
        windSpeed: 6,
        windDirection: 120,
        waveHeight: 0.3,
        currentSpeed: 1.2,
        currentDirection: 260,
        visibility: 10,
        weatherCondition: 'Hazy',
      },
    ],
  },
  {
    routeId: 'route-sg-rtm',
    from: 'Singapore',
    to: 'Rotterdam',
    totalDistance: 8430,
    overallRisk: 'MEDIUM',
    recommendations: [
      'Route via Suez Canal to save 3,800nm vs Cape of Good Hope',
      'Expect weather delay north of Bay of Biscay - recommend 12 knot speed reduction',
      'Schedule canal transit for 0500 local to avoid peak traffic',
      'Monitor Red Sea piracy advisory bulletins',
    ],
    waypoints: [
      {
        lat: 1.26,
        lon: 103.82,
        name: 'Singapore (Departure)',
        windSpeed: 8,
        windDirection: 180,
        waveHeight: 0.5,
        currentSpeed: 0.8,
        currentDirection: 220,
        visibility: 12,
        weatherCondition: 'Clear',
      },
      {
        lat: 5.5,
        lon: 100.0,
        name: 'Malacca Strait North',
        windSpeed: 10,
        windDirection: 190,
        waveHeight: 0.7,
        currentSpeed: 1.0,
        currentDirection: 300,
        visibility: 10,
        weatherCondition: 'Partly Cloudy',
      },
      {
        lat: 11.0,
        lon: 44.0,
        name: 'Gulf of Aden',
        windSpeed: 20,
        windDirection: 225,
        waveHeight: 2.2,
        currentSpeed: 0.7,
        currentDirection: 270,
        visibility: 8,
        weatherCondition: 'Rough',
        warning: 'High-risk maritime security area. Maintain BMP5 measures. Anti-piracy watch.',
      },
      {
        lat: 27.2,
        lon: 34.0,
        name: 'Red Sea (Mid)',
        windSpeed: 16,
        windDirection: 350,
        waveHeight: 1.4,
        currentSpeed: 0.5,
        currentDirection: 0,
        visibility: 12,
        weatherCondition: 'Clear',
      },
      {
        lat: 30.65,
        lon: 32.35,
        name: 'Suez Canal (South)',
        windSpeed: 12,
        windDirection: 315,
        waveHeight: 0.2,
        currentSpeed: 0.3,
        currentDirection: 0,
        visibility: 15,
        weatherCondition: 'Clear',
      },
      {
        lat: 36.0,
        lon: 14.0,
        name: 'Mediterranean (Mid)',
        windSpeed: 18,
        windDirection: 270,
        waveHeight: 1.8,
        currentSpeed: 0.4,
        currentDirection: 180,
        visibility: 10,
        weatherCondition: 'Overcast',
      },
      {
        lat: 43.0,
        lon: -4.0,
        name: 'Bay of Biscay',
        windSpeed: 28,
        windDirection: 240,
        waveHeight: 3.5,
        currentSpeed: 0.6,
        currentDirection: 90,
        visibility: 6,
        weatherCondition: 'Rough',
        warning: 'Bay of Biscay swell 3-4m. Recommend reducing speed to 11 knots. Secure all deck cargo.',
      },
      {
        lat: 48.0,
        lon: -5.5,
        name: 'English Channel Approach',
        windSpeed: 22,
        windDirection: 225,
        waveHeight: 2.0,
        currentSpeed: 1.0,
        currentDirection: 45,
        visibility: 8,
        weatherCondition: 'Overcast',
      },
      {
        lat: 51.95,
        lon: 4.14,
        name: 'Rotterdam (Arrival)',
        windSpeed: 14,
        windDirection: 270,
        waveHeight: 0.8,
        currentSpeed: 0.5,
        currentDirection: 315,
        visibility: 10,
        weatherCondition: 'Partly Cloudy',
      },
    ],
  },
];

export const getRouteWeather = (from: string, to: string): RouteWeather | undefined => {
  return MOCK_WEATHER_ROUTES.find(
    (r) =>
      r.from.toLowerCase().includes(from.toLowerCase()) &&
      r.to.toLowerCase().includes(to.toLowerCase())
  );
};

export const getRouteById = (routeId: string): RouteWeather | undefined => {
  return MOCK_WEATHER_ROUTES.find((r) => r.routeId === routeId);
};
