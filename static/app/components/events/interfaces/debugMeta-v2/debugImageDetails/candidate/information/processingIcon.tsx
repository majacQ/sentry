import * as Sentry from '@sentry/react';

import Tooltip from 'sentry/components/tooltip';
import {IconCheckmark, IconClose, IconWarning} from 'sentry/icons';
import {
  CandidateProcessingInfo,
  CandidateProcessingStatus,
} from 'sentry/types/debugImage';

type Props = {
  processingInfo: CandidateProcessingInfo;
};

function ProcessingIcon({processingInfo}: Props) {
  switch (processingInfo.status) {
    case CandidateProcessingStatus.OK:
      return <IconCheckmark color="green300" size="xs" />;
    case CandidateProcessingStatus.ERROR: {
      const {details} = processingInfo;
      return (
        <Tooltip title={details} disabled={!details}>
          <IconClose color="red300" size="xs" />
        </Tooltip>
      );
    }
    case CandidateProcessingStatus.MALFORMED: {
      const {details} = processingInfo;
      return (
        <Tooltip title={details} disabled={!details}>
          <IconWarning color="yellow300" size="xs" />
        </Tooltip>
      );
    }
    default: {
      Sentry.withScope(scope => {
        scope.setLevel(Sentry.Severity.Warning);
        Sentry.captureException(
          new Error('Unknown image candidate ProcessingIcon status')
        );
      });
      return null; // this shall never happen
    }
  }
}

export default ProcessingIcon;
