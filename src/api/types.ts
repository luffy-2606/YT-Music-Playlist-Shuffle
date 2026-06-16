/**
 * Type definitions for YouTube Music's internal Innertube API.
 *
 * These types are reverse-engineered from YT Music's network traffic.
 * see RESEARCH.md for details.
 */

export interface YtCfgData {
  INNERTUBE_API_KEY: string;
  INNERTUBE_CLIENT_VERSION: string;
  INNERTUBE_CONTEXT_CLIENT_VERSION: string;
  VISITOR_DATA: string;
  INNERTUBE_CONTEXT: InnertubeContext;
  INNERTUBE_CONTEXT_CLIENT_NAME: number; // 67 for WEB_REMIX
}

export interface InnertubeContext {
  client: ClientContext;
  user?: UserContext;
  request?: RequestContext;
  clickTracking?: { clickTrackingParams: string };
}

export interface ClientContext {
  clientName: string;
  clientVersion: string;
  hl: string;
  gl: string;
  visitorData?: string;
  userAgent?: string;
  platform?: string;
  originalUrl?: string;
  deviceMake?: string;
  deviceModel?: string;
  osName?: string;
  osVersion?: string;
  browserName?: string;
  browserVersion?: string;
}

export interface UserContext {
  lockedSafetyMode: boolean;
}

export interface RequestContext {
  useSsl: boolean;
  internalExperimentFlags?: unknown[];
}

// Domain model
export interface PlaylistTrack {
  videoId: string;
  setVideoId: string;
  title: string;
  artist: string;
  duration: string;
  index: number;
}

export interface PlaylistData {
  playlistId: string;
  title: string;
  tracks: PlaylistTrack[];
  totalTrackCount?: number;
}

// Playlist edit actions
export type PlaylistEditActionType =
  | 'ACTION_MOVE_VIDEO_BEFORE'
  | 'ACTION_REMOVE_VIDEO'
  | 'ACTION_ADD_VIDEO';

export interface MoveVideoAction {
  action: 'ACTION_MOVE_VIDEO_BEFORE';
  setVideoId: string;
  movedSetVideoIdSuccessor: string;
}

export interface RemoveVideoAction {
  action: 'ACTION_REMOVE_VIDEO';
  setVideoId: string;
  removedVideoId: string;
}

export interface AddVideoAction {
  action: 'ACTION_ADD_VIDEO';
  addedVideoId: string;
}

export type PlaylistEditAction =
  | MoveVideoAction
  | RemoveVideoAction
  | AddVideoAction;

export interface EditPlaylistResponse {
  status: string;
  playlistEditResults?: Array<{
    status: string;
    playlistId: string;
  }>;
}

// Browse API response types
export interface BrowseResponse {
  header?: PlaylistHeader;
  contents?: BrowseContents;
  continuationContents?: ContinuationContents;
  trackingParams?: string;
}

export interface PlaylistHeader {
  musicImmersiveHeaderRenderer?: {
    title?: TextObject;
    thumbnail?: ThumbnailObject;
  };
  musicDetailHeaderRenderer?: {
    title?: TextObject;
    subtitle?: TextObject;
    thumbnail?: ThumbnailObject;
    secondSubtitle?: TextObject;
  };
}

export interface BrowseContents {
  singleColumnBrowseResultsRenderer?: {
    tabs: Tab[];
  };
}

export interface Tab {
  tabRenderer?: {
    content?: {
      sectionListRenderer?: {
        contents: SectionContent[];
      };
    };
  };
}

export interface SectionContent {
  musicShelfRenderer?: MusicShelfRenderer;
  musicCarouselShelfRenderer?: unknown;
}

export interface MusicShelfRenderer {
  contents: MusicShelfItem[];
  continuations?: Continuation[];
}

export interface ContinuationContents {
  musicShelfContinuation?: MusicShelfContinuation;
}

export interface MusicShelfContinuation {
  contents: MusicShelfItem[];
  continuations?: Continuation[];
}

export interface MusicShelfItem {
  musicResponsiveListItemRenderer?: MusicResponsiveListItemRenderer;
}

// Track item renderer
export interface MusicResponsiveListItemRenderer {
  trackingParams?: string;
  thumbnail?: ThumbnailObject;
  overlay?: ItemOverlay;
  flexColumns?: FlexColumn[];
  menu?: TopLevelMenu;
  playlistItemData?: PlaylistItemData;
  index?: { runs?: Array<{ text: string }> };
  fixedColumns?: FlexColumn[];
}

export interface PlaylistItemData {
  videoId?: string;
  playlistSetVideoId?: string;
}

export interface FlexColumn {
  musicResponsiveListItemFlexColumnRenderer?: {
    text?: TextObject;
  };
}

export interface ItemOverlay {
  musicItemThumbnailOverlayRenderer?: {
    content?: {
      musicPlayButtonRenderer?: {
        playNavigationEndpoint?: {
          watchEndpoint?: {
            videoId?: string;
            playlistId?: string;
            index?: number;
            playlistSetVideoId?: string;
          };
        };
      };
    };
    menu?: {
      menuRenderer?: MenuRenderer;
    };
  };
}

export interface TopLevelMenu {
  menuRenderer?: MenuRenderer;
}

export interface MenuRenderer {
  items?: MenuItem[];
}

export interface MenuItem {
  menuServiceItemRenderer?: {
    text?: TextObject;
    serviceEndpoint?: {
      playlistEditEndpoint?: {
        playlistId?: string;
        actions?: Array<{
          action?: string;
          setVideoId?: string;
          removedVideoId?: string;
        }>;
      };
    };
  };
  menuNavigationItemRenderer?: {
    text?: TextObject;
    navigationEndpoint?: unknown;
  };
}

// Pagination

export interface Continuation {
  nextContinuationData?: {
    continuation: string;
    clickTrackingParams?: string;
  };
  reloadContinuationData?: {
    continuation: string;
    clickTrackingParams?: string;
  };
}


// Shared primitives

export interface TextObject {
  runs?: Array<{ text: string; bold?: boolean }>;
  simpleText?: string;
}

export interface ThumbnailObject {
  thumbnails?: Array<{ url: string; width: number; height: number }>;
  musicThumbnailRenderer?: {
    thumbnail?: ThumbnailObject;
  };
}
