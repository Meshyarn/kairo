import { FilenameScorer } from '../../../engine/scoring/FilenameScorer.js';

describe('FilenameScorer', () => {
    let scorer: FilenameScorer;

    beforeEach(() => {
        scorer = new FilenameScorer();
    });

    test('should score exact matches highly', () => {
        const score = scorer.calculateFilenameScore('src/User.ts', 'User', { fuzzy: false, basenameOnly: true });
        expect(score).toBeGreaterThan(0);
    });

    test('should handle fuzzy matching', () => {
        const score = scorer.calculateFilenameScore('src/UserService.ts', 'UserService', { fuzzy: true, basenameOnly: true });
        expect(score).toBeGreaterThan(0);
    });

    test('scoreFilename returns exact for basename or stem matches', () => {
        expect(scorer.scoreFilename('src/UserService.ts', ['userservice'])).toBe('exact');
        expect(scorer.scoreFilename('src/UserService.ts', ['userservice.ts'])).toBe('exact');
    });

    test('scoreFilename honors word boundary settings', () => {
        expect(scorer.scoreFilename('src/UserService.ts', ['service'])).toBe('partial');
        expect(scorer.scoreFilename('src/UserService.ts', ['service'], { wordBoundary: true })).toBe('none');
    });

    test('scoreFilename returns none when no keywords match', () => {
        expect(scorer.scoreFilename('src/UserService.ts', [''])).toBe('none');
        expect(scorer.scoreFilename('src/UserService.ts', ['other'])).toBe('none');
    });

    test('calculateFilenameScore ranks exact path and basename matches', () => {
        const exactPath = scorer.calculateFilenameScore('src/User.ts', 'src/user.ts', { fuzzy: false, basenameOnly: false });
        expect(exactPath).toBe(100);

        const basenameMatch = scorer.calculateFilenameScore('src/User.ts', 'user.ts', { fuzzy: false, basenameOnly: false });
        expect(basenameMatch).toBe(90);
    });

    test('calculateFilenameScore handles prefix, contains, and fuzzy paths', () => {
        const startsWith = scorer.calculateFilenameScore('src/UserService.ts', 'src/us', { fuzzy: false, basenameOnly: false });
        expect(startsWith).toBe(80);

        const contains = scorer.calculateFilenameScore('src/UserService.ts', 'service', { fuzzy: false, basenameOnly: false });
        expect(contains).toBe(60);

        const fuzzy = scorer.calculateFilenameScore('src/UserService.ts', 'UserServce.ts', { fuzzy: true, basenameOnly: true });
        expect(fuzzy).toBeGreaterThan(0);
    });
});
