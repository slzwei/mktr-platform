/**
 * Tropic Office — color system (shared across lyfe-app, lyfe-sg, mktr-platform).
 *
 * Warm, editorial, humane. Terracotta-forward accent on a cream base.
 *
 * Philosophy:
 * - Cream base (#F5F0E6), not iOS neutral #F2F2F7
 * - Terracotta (#D6552B) accent
 * - Soft tinted surfaces (sage, pink, butter) for categorical stats
 * - Hairline rules visible — card borders are 1px #E6E0D1, not transparent
 * - Dark mode is warm-dark (#141310), never pure black
 *
 * Source of truth. All web + native consumers read from here.
 */

const terracotta = {
    primary: '#D6552B',
    light: '#F7E7DC',
    dark: '#A53F1E',
    muted: '#E89574',
};

export const Colors = {
    light: {
        background: '#F5F0E6',
        surfacePrimary: '#FBF7EE',
        surfaceSecondary: '#F5F0E6',
        surfaceElevated: '#FFFFFF',

        textPrimary: '#1B1A17',
        textSecondary: '#4A4640',
        textTertiary: '#8B857A',
        textInverse: '#FBF7EE',

        accent: terracotta.primary,
        accentLight: terracotta.light,
        accentDark: terracotta.dark,
        accentMuted: terracotta.muted,

        success: '#7A8C6B',
        successLight: '#E8EDE0',
        warning: '#C89B3C',
        warningLight: '#F7ECCF',
        danger: '#B33A2E',
        dangerLight: '#F7DDD6',
        info: '#5C7A9E',
        infoLight: '#DFE6EF',

        border: '#E6E0D1',
        borderLight: '#EFEADB',
        divider: '#D8D1BE',

        cardBackground: '#FBF7EE',
        cardBorder: '#E6E0D1',
        tabBar: '#FBF7EE',
        tabBarBorder: '#E6E0D1',
        inputBackground: '#FFFFFF',
        inputBorder: '#E6E0D1',

        managerColor: '#5C7A9E',
        managerColorLight: '#DFE6EF',

        statusNew: '#5C7A9E',
        statusContacted: '#C89B3C',
        statusQualified: '#7A8C6B',
        statusProposed: '#B27AAE',
        statusWon: '#7A8C6B',
        statusLost: '#B33A2E',

        webViewBg: '#FBF7EE',
        webViewText: '#1B1A17',

        shadow: 'rgba(27, 26, 23, 0.06)',

        statusLive: '#7A8C6B',

        seedLyfe: '#7A8C6B',
        sproutLyfe: '#8FA377',

        roadmapTraining: '#5C7A9E',
        roadmapExam: '#D6552B',
        roadmapResource: '#7A8C6B',

        tabIconDefault: '#8B857A',
        tabIconSelected: terracotta.primary,

        paperElevated: '#FFFFFF',
        tintSage: '#EAEFE1',
        tintTerra: '#F7E7DC',
        tintPink: '#F2E0E7',
        tintButter: '#F7ECCF',
        inkWarm: '#1B1A17',
        hairline: '#EFEADB',

        whatsappGreen: '#4A9E6F',
    },

    dark: {
        background: '#141310',
        surfacePrimary: '#1F1D18',
        surfaceSecondary: '#141310',
        surfaceElevated: '#2A2721',

        textPrimary: '#F5F0E6',
        textSecondary: '#D6CFBD',
        textTertiary: '#8B857A',
        textInverse: '#141310',

        accent: '#E27A4E',
        accentLight: '#3A2419',
        accentDark: terracotta.primary,
        accentMuted: '#B5603F',

        success: '#9CAE8C',
        successLight: '#1E261A',
        warning: '#E5B858',
        warningLight: '#2D2516',
        danger: '#D85547',
        dangerLight: '#2D1714',
        info: '#87A3C4',
        infoLight: '#16202D',

        border: '#2F2B24',
        borderLight: '#24211B',
        divider: '#3A362E',

        cardBackground: '#1F1D18',
        cardBorder: '#2F2B24',
        tabBar: '#1F1D18',
        tabBarBorder: '#2F2B24',
        inputBackground: '#2A2721',
        inputBorder: '#3A362E',

        managerColor: '#87A3C4',
        managerColorLight: '#16202D',

        statusNew: '#87A3C4',
        statusContacted: '#E5B858',
        statusQualified: '#9CAE8C',
        statusProposed: '#C79BC3',
        statusWon: '#9CAE8C',
        statusLost: '#D85547',

        webViewBg: '#1F1D18',
        webViewText: '#F5F0E6',

        shadow: 'rgba(0, 0, 0, 0.5)',

        statusLive: '#9CAE8C',

        seedLyfe: '#9CAE8C',
        sproutLyfe: '#ADBF9B',

        roadmapTraining: '#87A3C4',
        roadmapExam: '#E27A4E',
        roadmapResource: '#9CAE8C',

        tabIconDefault: '#8B857A',
        tabIconSelected: '#E27A4E',

        paperElevated: '#2A2721',
        tintSage: '#1E261A',
        tintTerra: '#3A2419',
        tintPink: '#2F1E28',
        tintButter: '#2D2516',
        inkWarm: '#F5F0E6',
        hairline: '#24211B',

        whatsappGreen: '#6AB88A',
    },
};

export type ColorScheme = keyof typeof Colors;
export type ColorToken = keyof typeof Colors['light'];
