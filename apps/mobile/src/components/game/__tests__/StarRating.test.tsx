import { fireEvent, render, screen } from '@testing-library/react-native';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { StarRating } from '../StarRating';

describe('StarRating', () => {
  it('renders five radio stars and reports the tapped value', async () => {
    const onChange = jest.fn();
    await render(<StarRating value={0} onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    await fireEvent.press(screen.getByTestId('star-4'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('marks the selected star checked and honours disabled', async () => {
    const onChange = jest.fn();
    await render(<StarRating value={3} onChange={onChange} disabled />);
    expect(screen.getByTestId('star-3').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId('star-5'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
