import { fireEvent, render, screen } from '@testing-library/react-native';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { StarRating } from '../StarRating';

describe('StarRating', () => {
  it('renders five radio stars and reports the tapped value', () => {
    const onChange = jest.fn();
    render(<StarRating value={0} onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    fireEvent.press(screen.getByTestId('star-4'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('marks the selected star checked and honours disabled', () => {
    const onChange = jest.fn();
    render(<StarRating value={3} onChange={onChange} disabled />);
    expect(screen.getByTestId('star-3').props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(screen.getByTestId('star-5'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
