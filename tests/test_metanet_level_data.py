import unittest

from fetch_metanet_level_data import extract_level_data


class WikiLevelDataTests(unittest.TestCase):
    def test_classic_string_and_html_entities_are_preserved_as_visible_text(self):
        raw = '%00-0: test &amp; title#' + '01' * 700 + '#'
        self.assertEqual(extract_level_data('== Level data ==\n <code>' + raw + '</code>', '00-0'), raw.replace('&amp;', '&'))

    def test_dollar_format_preserves_punctuation_and_tile_characters(self):
        raw = '$00-1: tutorial: jumping, long#metanet#Nv2#' + '<01?' * 250 + '|5^10,20!#'
        self.assertEqual(extract_level_data('== Level data ==\n <code>' + raw + '</code>', '00-1'), raw)

    def test_unclosed_wiki_code_does_not_include_category_markup(self):
        raw = '$01-2: come back zinc!#metanet#Nv2#' + '01' * 700 + '#'
        self.assertEqual(extract_level_data('== Level data ==\n <code>' + raw + '[[Category:Levels]]', '01-2'), raw)

    def test_missing_format_prefix_is_not_added_to_published_wiki_text(self):
        raw = 'a5-3: @_@#DemonzLunchBreak#Nv2#' + '01' * 700 + '#'
        self.assertEqual(extract_level_data('== Level data ==\n <code>' + raw + '</code>', 'a5-3'), raw)

    def test_missing_truncated_and_wrong_level_strings_are_rejected(self):
        for source in ('== Other section ==\n<code>%00-0: test#' + '01' * 700 + '#</code>',
                       '== Level data ==\n<code>%00-0: short#01#</code>',
                       '== Level data ==\n<code>%00-1: wrong#' + '01' * 700 + '#</code>'):
            with self.subTest(source=source[:50]), self.assertRaises(ValueError):
                extract_level_data(source, '00-0')


if __name__ == '__main__':
    unittest.main()
