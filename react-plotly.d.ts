// react-plotly.d.ts

declare module 'react-plotly.js' {
    import * as React from 'react';
  
    interface PlotParams {
      data?: any[];
      layout?: any;
      config?: any;
      frames?: any[];
      revision?: number;
      onInitialized?: (figure: any, graphDiv: HTMLElement) => void;
      onUpdate?: (figure: any, graphDiv: HTMLElement) => void;
      onPurge?: () => void;
      onError?: (error: Error) => void;
      debug?: boolean;
      style?: React.CSSProperties;
      className?: string;
      useResizeHandler?: boolean;
      divId?: string;
      divClassName?: string;
    }
  
    export default class Plot extends React.Component<PlotParams, any> {}
  }
  