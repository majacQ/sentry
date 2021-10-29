import {PureComponent} from 'react';
import color from 'color';
import debounce from 'lodash/debounce';
import flatten from 'lodash/flatten';

import AreaChart, {AreaChartSeries} from 'app/components/charts/areaChart';
import Graphic from 'app/components/charts/components/graphic';
import {LineChartSeries} from 'app/components/charts/lineChart';
import LineSeries from 'app/components/charts/series/lineSeries';
import space from 'app/styles/space';
import {GlobalSelection} from 'app/types';
import {ReactEchartsRef, Series} from 'app/types/echarts';
import theme from 'app/utils/theme';
import {
  ALERT_CHART_MIN_MAX_BUFFER,
  alertAxisFormatter,
  alertTooltipValueFormatter,
  isSessionAggregate,
  shouldScaleAlertChart,
} from 'app/views/alerts/utils';

import {AlertRuleThresholdType, IncidentRule, Trigger} from '../../types';

type DefaultProps = {
  data: Series[];
  comparisonData: Series[];
  comparisonMarkLines: LineChartSeries[];
};

type Props = DefaultProps & {
  triggers: Trigger[];
  resolveThreshold: IncidentRule['resolveThreshold'];
  thresholdType: IncidentRule['thresholdType'];
  aggregate: string;
  hideThresholdLines: boolean;
  minutesThresholdToDisplaySeconds?: number;
  maxValue?: number;
  minValue?: number;
  comparisonSeriesName?: string;
} & Partial<GlobalSelection['datetime']>;

type State = {
  width: number;
  height: number;
  yAxisMax: number | null;
  yAxisMin: number | null;
};

const CHART_GRID = {
  left: space(2),
  right: space(2),
  top: space(4),
  bottom: space(2),
};

// Colors to use for trigger thresholds
const COLOR = {
  RESOLUTION_FILL: color(theme.green200).alpha(0.1).rgb().string(),
  CRITICAL_FILL: color(theme.red300).alpha(0.25).rgb().string(),
  WARNING_FILL: color(theme.yellow200).alpha(0.1).rgb().string(),
};

/**
 * This chart displays shaded regions that represent different Trigger thresholds in a
 * Metric Alert rule.
 */
export default class ThresholdsChart extends PureComponent<Props, State> {
  static defaultProps: DefaultProps = {
    data: [],
    comparisonData: [],
    comparisonMarkLines: [],
  };

  state: State = {
    width: -1,
    height: -1,
    yAxisMax: null,
    yAxisMin: null,
  };

  componentDidMount() {
    this.handleUpdateChartAxis();
  }

  componentDidUpdate(prevProps: Props) {
    if (
      this.props.triggers !== prevProps.triggers ||
      this.props.data !== prevProps.data ||
      this.props.comparisonData !== prevProps.comparisonData ||
      this.props.comparisonMarkLines !== prevProps.comparisonMarkLines
    ) {
      this.handleUpdateChartAxis();
    }
  }

  ref: null | ReactEchartsRef = null;

  // If we have ref to chart and data, try to update chart axis so that
  // alertThreshold or resolveThreshold is visible in chart
  handleUpdateChartAxis = () => {
    const {triggers, resolveThreshold, hideThresholdLines} = this.props;
    const chartRef = this.ref?.getEchartsInstance?.();
    if (hideThresholdLines) {
      return;
    }

    if (chartRef) {
      const thresholds = [
        resolveThreshold || null,
        ...triggers.map(t => t.alertThreshold || null),
      ].filter(threshold => threshold !== null) as number[];
      this.updateChartAxis(Math.min(...thresholds), Math.max(...thresholds));
    }
  };

  /**
   * Updates the chart so that yAxis is within bounds of our max value
   */
  updateChartAxis = debounce((minThreshold: number, maxThreshold: number) => {
    const {minValue, maxValue, aggregate} = this.props;
    const shouldScale = shouldScaleAlertChart(aggregate);
    let yAxisMax =
      shouldScale && maxValue
        ? this.clampMaxValue(Math.ceil(maxValue * ALERT_CHART_MIN_MAX_BUFFER))
        : null;
    let yAxisMin =
      shouldScale && minValue ? Math.floor(minValue / ALERT_CHART_MIN_MAX_BUFFER) : 0;

    if (typeof maxValue === 'number' && maxThreshold > maxValue) {
      yAxisMax = maxThreshold;
    }
    if (typeof minValue === 'number' && minThreshold < minValue) {
      yAxisMin = Math.floor(minThreshold / ALERT_CHART_MIN_MAX_BUFFER);
    }

    // We need to force update after we set a new yAxis min/max because `convertToPixel`
    // can return a negative position (probably because yAxisMin/yAxisMax is not synced with chart yet)
    this.setState({yAxisMax, yAxisMin}, this.forceUpdate);
  }, 150);

  /**
   * Syncs component state with the chart's width/heights
   */
  updateDimensions = () => {
    const chartRef = this.ref?.getEchartsInstance?.();
    if (!chartRef) {
      return;
    }

    const width = chartRef.getWidth();
    const height = chartRef.getHeight();
    if (width !== this.state.width || height !== this.state.height) {
      this.setState({
        width,
        height,
      });
    }
  };

  handleRef = (ref: ReactEchartsRef): void => {
    // When chart initially renders, we want to update state with its width, as well as initialize starting
    // locations (on y axis) for the draggable lines
    if (ref && !this.ref) {
      this.ref = ref;
      this.updateDimensions();
      this.handleUpdateChartAxis();
    }

    if (!ref) {
      this.ref = null;
    }
  };

  /**
   * Draws the boundary lines and shaded areas for the chart.
   *
   * May need to refactor so that they are aware of other trigger thresholds.
   *
   * e.g. draw warning from threshold -> critical threshold instead of the entire height of chart
   */
  getThresholdLine = (
    trigger: Trigger,
    type: 'alertThreshold' | 'resolveThreshold',
    isResolution: boolean
  ) => {
    const {thresholdType, resolveThreshold, maxValue, hideThresholdLines} = this.props;
    const position =
      type === 'alertThreshold'
        ? this.getChartPixelForThreshold(trigger[type])
        : this.getChartPixelForThreshold(resolveThreshold);
    const isInverted = thresholdType === AlertRuleThresholdType.BELOW;
    const chartRef = this.ref?.getEchartsInstance?.();

    if (
      typeof position !== 'number' ||
      isNaN(position) ||
      !this.state.height ||
      !chartRef ||
      hideThresholdLines
    ) {
      return [];
    }

    const yAxisPixelPosition = chartRef.convertToPixel(
      {yAxisIndex: 0},
      `${this.state.yAxisMin}`
    );
    const yAxisPosition = typeof yAxisPixelPosition === 'number' ? yAxisPixelPosition : 0;
    // As the yAxis gets larger we want to start our line/area further to the right
    // Handle case where the graph max is 1 and includes decimals
    const yAxisMax =
      (Math.round(Math.max(maxValue ?? 1, this.state.yAxisMax ?? 1)) * 100) / 100;
    const yAxisSize = 15 + (yAxisMax <= 1 ? 15 : `${yAxisMax ?? ''}`.length * 8);
    // Shave off the right margin and yAxisSize from the width to get the actual area we want to render content in
    const graphAreaWidth =
      this.state.width - parseInt(CHART_GRID.right.slice(0, -2), 10) - yAxisSize;
    // Distance from the top of the chart to save for the legend
    const legendPadding = 20;
    // Shave off the left margin
    const graphAreaMargin = 7;

    const isCritical = trigger.label === 'critical';
    const LINE_STYLE = {
      stroke: isResolution ? theme.green300 : isCritical ? theme.red300 : theme.yellow300,
      lineDash: [2],
    };

    return [
      // This line is used as a "border" for the shaded region
      // and represents the threshold value.
      {
        type: 'line',
        // Resolution is considered "off" if it is -1
        invisible: position === null,
        draggable: false,
        position: [yAxisSize, position],
        shape: {y1: 1, y2: 1, x1: graphAreaMargin, x2: graphAreaWidth},
        style: LINE_STYLE,
        z: 100,
      },

      // Shaded area for incident/resolutions to show user when they can expect to be alerted
      // (or when they will be considered as resolved)
      //
      // Resolution is considered "off" if it is -1
      ...(position !== null
        ? [
            {
              type: 'rect',
              draggable: false,

              position:
                isResolution !== isInverted
                  ? [yAxisSize + graphAreaMargin, position + 1]
                  : [yAxisSize + graphAreaMargin, legendPadding],
              shape: {
                width: graphAreaWidth - graphAreaMargin,
                height:
                  isResolution !== isInverted
                    ? yAxisPosition - position
                    : position - legendPadding,
              },

              style: {
                fill: isResolution
                  ? COLOR.RESOLUTION_FILL
                  : isCritical
                  ? COLOR.CRITICAL_FILL
                  : COLOR.WARNING_FILL,
              },

              // This needs to be below the draggable line
              z: 100,
            },
          ]
        : []),
    ];
  };

  getChartPixelForThreshold = (threshold: number | '' | null) => {
    const chartRef = this.ref?.getEchartsInstance?.();
    return (
      threshold !== '' &&
      chartRef &&
      chartRef.convertToPixel({yAxisIndex: 0}, `${threshold}`)
    );
  };

  clampMaxValue(value: number) {
    // When we apply top buffer to the crash free percentage (99.7% * 1.03), it
    // can cross 100%, so we clamp it
    if (isSessionAggregate(this.props.aggregate) && value > 100) {
      return 100;
    }

    return value;
  }

  render() {
    const {
      data,
      triggers,
      period,
      aggregate,
      comparisonData,
      comparisonSeriesName,
      comparisonMarkLines,
      minutesThresholdToDisplaySeconds,
    } = this.props;

    const dataWithoutRecentBucket: AreaChartSeries[] = data?.map(
      ({data: eventData, ...restOfData}) => ({
        ...restOfData,
        data: eventData.slice(0, -1),
      })
    );

    const comparisonDataWithoutRecentBucket = comparisonData?.map(
      ({data: eventData, ...restOfData}) => ({
        ...restOfData,
        data: eventData.slice(0, -1),
      })
    );

    // Disable all lines by default but the 1st one
    const selected: Record<string, boolean> = dataWithoutRecentBucket.reduce(
      (acc, {seriesName}, index) => {
        acc[seriesName] = index === 0;
        return acc;
      },
      {}
    );
    const legend = {
      right: 10,
      top: 0,
      selected,
      data: data.map(d => ({name: d.seriesName})),
    };

    const chartOptions = {
      tooltip: {
        // use the main aggregate for all series (main, min, max, avg, comparison)
        // to format all values similarly
        valueFormatter: (value: number) =>
          alertTooltipValueFormatter(value, aggregate, aggregate),

        markerFormatter: (marker: string, seriesName?: string) => {
          if (seriesName === comparisonSeriesName) {
            return '<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:transparent;"></span>';
          }
          return marker;
        },
      },
      yAxis: {
        min: this.state.yAxisMin ?? undefined,
        max: this.state.yAxisMax ?? undefined,
        axisLabel: {
          formatter: (value: number) =>
            alertAxisFormatter(value, data[0].seriesName, aggregate),
        },
      },
    };

    return (
      <AreaChart
        isGroupedByDate
        showTimeInTooltip
        minutesThresholdToDisplaySeconds={minutesThresholdToDisplaySeconds}
        period={period}
        forwardedRef={this.handleRef}
        grid={CHART_GRID}
        {...chartOptions}
        legend={legend}
        graphic={Graphic({
          elements: flatten(
            triggers.map((trigger: Trigger) => [
              ...this.getThresholdLine(trigger, 'alertThreshold', false),
              ...this.getThresholdLine(trigger, 'resolveThreshold', true),
            ])
          ),
        })}
        series={[...dataWithoutRecentBucket, ...comparisonMarkLines]}
        additionalSeries={[
          ...comparisonDataWithoutRecentBucket.map(({data: _data, ...otherSeriesProps}) =>
            LineSeries({
              name: comparisonSeriesName,
              data: _data.map(({name, value}) => [name, value]),
              lineStyle: {color: theme.gray200, type: 'dashed', width: 1},
              animation: false,
              animationThreshold: 1,
              animationDuration: 0,
              ...otherSeriesProps,
            })
          ),
        ]}
        onFinished={() => {
          // We want to do this whenever the chart finishes re-rendering so that we can update the dimensions of
          // any graphics related to the triggers (e.g. the threshold areas + boundaries)
          this.updateDimensions();
        }}
      />
    );
  }
}
