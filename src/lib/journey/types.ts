export type JourneyType = 'flight' | 'train' | 'road' | 'relax';
export type Hours = 2 | 5 | 8 | 12;
export type Experience = 'music' | 'mood' | 'stories' | 'podcasts' | 'trivia' | 'guess' | 'sing' | 'sleep' | 'memories';

export type JourneyPlan = {
  type: JourneyType; hours: Hours; storageMB: number; genres: string[];
  prefs: Record<Experience, boolean>; created_at: number;
};

export const JOURNEY_TYPES: { id: JourneyType; label: string; icon: string; blurb: string }[] = [
  { id: 'flight', label: 'Flight', icon: '✈️', blurb: 'No signal at 35,000 ft' },
  { id: 'train', label: 'Train', icon: '🚆', blurb: 'Long stretches, patchy coverage' },
  { id: 'road', label: 'Road Trip', icon: '🚗', blurb: 'Sing-alongs and open roads' },
  { id: 'relax', label: 'Relaxation', icon: '🧘', blurb: 'Slow down, switch off' },
];
export const HOURS: Hours[] = [2, 5, 8, 12];

export const EXPERIENCES: { id: Experience; label: string; blurb: string; milestone: number }[] = [
  { id: 'music', label: 'My Music Journey', blurb: 'A mix from your own library, sized to your trip', milestone: 1 },
  { id: 'mood', label: 'Mood DJ', blurb: 'Playlists by mood and duration', milestone: 5 },
  { id: 'stories', label: 'Audio Stories', blurb: 'Mystery, horror, comedy, romance, thrillers', milestone: 7 },
  { id: 'podcasts', label: 'Podcasts', blurb: 'Episodes saved for offline listening', milestone: 7 },
  { id: 'trivia', label: 'Music Trivia', blurb: 'Questions from your own collection', milestone: 4 },
  { id: 'guess', label: 'Guess the Song', blurb: 'Name that tune — fully offline', milestone: 4 },
  { id: 'sing', label: 'Sing Along', blurb: 'Synced lyrics on the go', milestone: 4 },
  { id: 'sleep', label: 'Sleep Journey', blurb: 'Rain, ocean, nature and calm', milestone: 6 },
  { id: 'memories', label: 'Journey Memories', blurb: 'Voice notes, photos and a travel diary', milestone: 7 },
];

export const defaultPlan = (): JourneyPlan => ({
  type: 'flight', hours: 5, storageMB: 2048, genres: [], created_at: Date.now(),
  prefs: { music: true, mood: true, stories: true, podcasts: true, trivia: true, guess: true, sing: true, sleep: true, memories: true },
});
