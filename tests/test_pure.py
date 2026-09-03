"""app.py 순수 함수 회귀 테스트.

의존성 없이 stdlib unittest 만 쓴다 — run.bat 이 설치하는 건 fastapi/uvicorn/python-multipart
뿐이고, 테스트 하나 돌리려고 pytest 를 끌어오면 "더블클릭이면 끝"이라는 전제가 깨진다.

원래는 app.py 안의 `_self_check()` assert 한 덩어리였다. 첫 assert 가 터지면 나머지가 전부
가려져서, 케이스별로 쪼개 어디까지 성했는지 보이게 옮겼다. `python app.py --self-check` 는
그대로 동작한다(이 파일을 실행하도록 위임).
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app  # noqa: E402


class TestSafeFilename(unittest.TestCase):
    def test_strips_illegal_chars(self):
        self.assertEqual(app.safe_filename("a/b:c*d?", "xx"), "abcd")

    def test_blank_falls_back_to_pid(self):
        self.assertEqual(app.safe_filename("   ", "pid7"), "pid7")

    def test_collapses_whitespace(self):
        self.assertEqual(app.safe_filename("  hi  world ", "x"), "hi world")

    def test_windows_reserved_names_get_suffix(self):
        self.assertEqual(app.safe_filename("CON", "x"), "CON_")
        self.assertEqual(app.safe_filename("nul", "x"), "nul_")

    def test_reserved_name_as_prefix_is_fine(self):
        """'CON' 은 예약어지만 'context' 는 아니다 — 접두사 일치로 오탐하면 안 된다."""
        self.assertEqual(app.safe_filename("context", "x"), "context")


class TestYamlStr(unittest.TestCase):
    def test_newline_never_survives(self):
        """frontmatter 값에 개행이 남으면 YAML 블록이 깨진다."""
        self.assertNotIn("\n", app._yaml_str("a\nb---\nc"))


class TestMergeNote(unittest.TestCase):
    """Obsidian 내보내기는 관리 블록만 갈아끼우고 사용자 메모는 보존해야 한다."""

    def test_replaces_managed_block_keeps_user_memo(self):
        p = Path(tempfile.mkdtemp()) / "n.md"
        p.write_text("OLD" + app.AUTO_END + "\n## 내 메모\nkeep me\n", encoding="utf-8")
        self.assertEqual(app.merge_note(p, "NEW" + app.AUTO_END),
                         "NEW" + app.AUTO_END + "\n## 내 메모\nkeep me\n")

    def test_new_file_gets_memo_section(self):
        m = app.merge_note(Path(tempfile.mkdtemp()) / "new.md", "HEAD" + app.AUTO_END)
        self.assertTrue(m.startswith("HEAD"))
        self.assertIn("## 내 메모", m)

    def test_marker_literal_in_body_uses_last_occurrence(self):
        """본문에 마커 리터럴이 섞여도 rfind 가 관리블록 '끝'을 잡아 메모가 살아남는다."""
        p = Path(tempfile.mkdtemp()) / "m.md"
        p.write_text("A" + app.AUTO_END + "B" + app.AUTO_END + "\nKEEP\n", encoding="utf-8")
        self.assertEqual(app.merge_note(p, "N" + app.AUTO_END), "N" + app.AUTO_END + "\nKEEP\n")

    def test_legacy_marker_note_keeps_memo(self):
        """구 이름(Moonlight)으로 내보낸 노트도 '내 메모'가 보존돼야 한다."""
        p = Path(tempfile.mkdtemp()) / "old.md"
        p.write_text("OLD" + app._OLD_END + "\n## 내 메모\nkeep me\n", encoding="utf-8")
        self.assertEqual(app.merge_note(p, "NEW" + app.AUTO_END),
                         "NEW" + app.AUTO_END + "\n## 내 메모\nkeep me\n")


class TestNoteOwnership(unittest.TestCase):
    """파일명이 겹쳤을 때 남의 노트를 덮어쓰지 않기 위한 판정."""

    def test_no_marker_is_foreign(self):
        self.assertTrue(app._note_owned_by_other("사용자 메모뿐", "p1"))

    def test_other_paper_id_is_foreign(self):
        self.assertTrue(app._note_owned_by_other("source: achird\npaper_id: other\n", "p1"))

    def test_same_paper_id_is_ours(self):
        self.assertFalse(app._note_owned_by_other("source: achird\npaper_id: p1\n", "p1"))

    def test_legacy_source_is_ours(self):
        self.assertFalse(app._note_owned_by_other("source: moonlight\npaper_id: p1\n", "p1"))


class TestFileSha256(unittest.TestCase):
    def test_same_bytes_same_hash(self):
        hp = Path(tempfile.mkdtemp())
        (hp / "a").write_bytes(b"pdfbytes")
        (hp / "b").write_bytes(b"pdfbytes")
        (hp / "c").write_bytes(b"other")
        self.assertEqual(app.file_sha256(hp / "a"), app.file_sha256(hp / "b"))
        self.assertNotEqual(app.file_sha256(hp / "a"), app.file_sha256(hp / "c"))


class TestExportPdfGate(unittest.TestCase):
    """export_pdf=false 면 볼트에 PDF 사본을 두지 않는다 — 노트에서 PDF 참조도 함께 빠져야
    한다. 프론트매터에 죽은 `pdf_vault:` 가 남거나 본문에 깨진 링크가 남으면 감사가 오탐한다."""

    def setUp(self):
        # app.LIB 를 임시 폴더로 — _mk_paper 가 사용자의 실제 서재에 유령 논문을 남겼었다
        # (id 없는 meta.json → 서가 카드의 PDF 링크가 /api/papers/undefined/pdf 로 400)
        self.tmp = tempfile.TemporaryDirectory()
        self.real_lib = app.LIB
        app.LIB = Path(self.tmp.name)

    def tearDown(self):
        app.LIB = self.real_lib
        self.tmp.cleanup()

    def _mk_paper(self) -> str:
        pid = "abcd1234"
        d = app.LIB / pid
        d.mkdir(exist_ok=True)
        (d / "meta.json").write_text('{"title": "T", "pages": 1}', encoding="utf-8")
        return pid

    def test_no_pdf_ref_when_disabled(self):
        md = app.note_markdown(self._mk_paper(), {"obsidian_subfolder": "S"}, "")
        self.assertNotIn("pdf_vault:", md)
        self.assertNotIn("PDF 열기", md)
        self.assertIn("Achird에서 열기", md)   # 리더 링크는 PDF 사본과 무관하게 살아야 한다

    def test_pdf_ref_present_when_enabled(self):
        rel = "attachments/x-abcd1234.pdf"
        md = app.note_markdown(self._mk_paper(), {"obsidian_subfolder": "S"}, rel)
        self.assertIn(f"pdf_vault: {app._yaml_str('S/' + rel)}", md)
        self.assertIn(f"[📄 PDF 열기](<{rel}>)", md)


class TestSearchNormalisation(unittest.TestCase):
    def test_joins_hyphenated_linebreak(self):
        self.assertEqual(app._norm_search("atten-\ntion  is\nall"), "attention is all")

    def test_preserves_case_collapses_space(self):
        self.assertEqual(app._norm_search("The  Quick\nBrown Fox"), "The Quick Brown Fox")

    def test_short_text_has_no_ellipsis(self):
        self.assertEqual(app._snip("abcdef", "abcdef", 2, 2), "abcdef")

    def test_long_text_is_trimmed_around_the_hit(self):
        long = "x" * 100 + "needle" + "y" * 200
        sn = app._snip(long, long, 100, 6)
        self.assertTrue(sn.startswith("…"))
        self.assertTrue(sn.endswith("…"))
        self.assertIn("needle", sn)


class TestCleanTags(unittest.TestCase):
    def test_trims_dedupes_keeps_order(self):
        self.assertEqual(app._clean_tags(["ml", " ml ", "", "nlp"]), ["ml", "nlp"])

    def test_caps_length_at_24(self):
        self.assertEqual(app._clean_tags(["x" * 30])[0], "x" * 24)

    def test_caps_count_at_8(self):
        self.assertEqual(len(app._clean_tags([str(i) for i in range(20)])), 8)


FULL_META = {"id": "abcd1234", "authors": ["Ashish Vaswani", "Noam Shazeer"], "year": 2017,
             "venue": "NeurIPS", "doi": "10.5555/xyz", "title": "Attention Is All You Need"}
EMPTY_META = {"id": "ff-00!!"}


class TestBibtexKey(unittest.TestCase):
    def test_surname_year_first_content_word(self):
        self.assertEqual(app._bibtex_key(FULL_META), "vaswani2017attention")

    def test_deterministic(self):
        self.assertEqual(app._bibtex_key(FULL_META), app._bibtex_key(FULL_META))

    def test_non_ascii_id_is_sanitised(self):
        key = app._bibtex_key(EMPTY_META)
        self.assertEqual(key, "ff00")
        self.assertRegex(key, r"^[a-z0-9]+$")

    def test_empty_meta_falls_back(self):
        self.assertEqual(app._bibtex_key({}), "paper")


class TestCiteStrings(unittest.TestCase):
    def test_full_meta_carries_every_field(self):
        c = app._cite_strings(FULL_META)
        for token in ("Vaswani", "2017", "NeurIPS"):
            self.assertIn(token, c["bibtex"])
        self.assertIn("Attention Is All You Need", c["apa"])
        self.assertIn("Attention Is All You Need", c["acs"])
        self.assertIn("https://doi.org/10.5555/xyz", c["apa"])

    def test_no_none_or_empty_dict_leaks(self):
        """None·{} 가 문자열에 새면 사용자가 그대로 논문에 붙여넣게 된다."""
        for meta in (FULL_META, EMPTY_META):
            for style, s in app._cite_strings(meta).items():
                self.assertNotIn("None", s, style)
                self.assertNotIn("{}", s, style)

    def test_empty_meta_gives_bodyless_entry(self):
        self.assertEqual(app._cite_strings(EMPTY_META)["bibtex"], "@article{ff00}")


class TestGraphEdges(unittest.TestCase):
    """서재 인용 그래프: doi 부분일치 우선, 없으면 정규화 제목(15자 이상) 부분일치."""

    PAPERS = [
        {"id": "p1", "title": "Attention Is All You Need", "doi": "10.5555/AAAA", "refs": []},
        {"id": "p2", "title": "Deep Residual Learning For Image Recognition", "doi": "",
         "refs": ["Vaswani et al., Attention Is All You Need, NeurIPS 2017.",
                  "Some unrelated reference with no matches at all."]},
        {"id": "p3", "title": "Something Else Entirely Different Study", "doi": "",
         "refs": ["See 10.5555/aaaa for the reference implementation used here."]},
        {"id": "p4", "title": "Short", "doi": "", "refs": ["nothing matches anything here"]},
    ]

    def setUp(self):
        self.edges = app._graph_edges(self.PAPERS)

    def test_title_match(self):
        self.assertIn({"from": "p2", "to": "p1", "why": "title"}, self.edges)

    def test_doi_match_is_case_insensitive(self):
        self.assertIn({"from": "p3", "to": "p1", "why": "doi"}, self.edges)

    def test_papers_without_matching_refs_have_no_outgoing_edge(self):
        self.assertFalse(any(e["from"] in ("p1", "p4") for e in self.edges))

    def test_no_spurious_edges(self):
        self.assertEqual(len(self.edges), 2)


class TestExtractJson(unittest.TestCase):
    """모델 출력 파서 — 여기서 실패하면 정렬·메타추출·서재질문이 통째로 죽는다."""

    def test_bare_object(self):
        self.assertEqual(app.extract_json('{"a": 1}'), {"a": 1})

    def test_bare_array(self):
        self.assertEqual(app.extract_json('[1, 2, 3]'), [1, 2, 3])

    def test_fenced_json(self):
        self.assertEqual(app.extract_json('```json\n{"a": 1}\n```'), {"a": 1})

    def test_fenced_without_language(self):
        self.assertEqual(app.extract_json('```\n[1]\n```'), [1])

    def test_prose_before_and_after(self):
        self.assertEqual(app.extract_json('네, 결과입니다:\n[{"s": "x"}]\n도움이 되었길.'),
                         [{"s": "x"}])

    def test_trailing_garbage_is_trimmed(self):
        """닫는 괄호를 뒤에서부터 줄여가며 파싱 — 모델이 뒤에 말을 더 붙여도 살아남는다."""
        self.assertEqual(app.extract_json('{"a": 1} 그리고 추가 설명입니다.'), {"a": 1})

    def test_nested_structures(self):
        self.assertEqual(app.extract_json('[{"a": [1, {"b": 2}]}]'), [{"a": [1, {"b": 2}]}])

    def test_unicode_survives(self):
        self.assertEqual(app.extract_json('{"t": "한글 값"}'), {"t": "한글 값"})

    def test_no_json_raises(self):
        with self.assertRaises(ValueError):
            app.extract_json("죄송합니다, 만들 수 없습니다.")

    def test_unparseable_braces_raise(self):
        with self.assertRaises(ValueError):
            app.extract_json("{not json at all")


class TestIdsHash(unittest.TestCase):
    """비교·근거표 캐시 파일명 — 순서가 달라도 같은 조합이면 같은 캐시를 맞춰야 한다."""

    def test_order_independent(self):
        self.assertEqual(app._ids_hash(["b", "a"]), app._ids_hash(["a", "b"]))

    def test_different_sets_differ(self):
        self.assertNotEqual(app._ids_hash(["a", "b"]), app._ids_hash(["a", "c"]))

    def test_subset_is_not_the_same(self):
        self.assertNotEqual(app._ids_hash(["a", "b"]), app._ids_hash(["a"]))

    def test_filename_safe_and_stable_length(self):
        h = app._ids_hash(["a", "b"])
        self.assertEqual(len(h), 16)
        self.assertRegex(h, r"^[0-9a-f]{16}$")


class TestVisionKey(unittest.TestCase):
    """그림·수식 캐시 키 인코딩(_vision_key)과 디코딩(_parse_figure_key)은 짝이다 —
    한쪽만 바뀌면 기존 캐시가 통째로 미스난다."""

    def test_no_region(self):
        self.assertEqual(app._vision_key(3, "", " hint "), ("", "3|hint"))

    def test_valid_region_kept(self):
        region, key = app._vision_key(3, "0.1,0.2,0.3,0.4", "h")
        self.assertEqual(region, "0.1,0.2,0.3,0.4")
        self.assertEqual(key, "3|0.1,0.2,0.3,0.4|h")

    def test_malformed_region_dropped(self):
        self.assertEqual(app._vision_key(3, "0.1,0.2", "h")[0], "")
        self.assertEqual(app._vision_key(3, "a,b,c,d", "h")[0], "")

    def test_round_trip_with_parse(self):
        _, key = app._vision_key(7, "0.1,0.2,0.3,0.4", "Fig 2")
        n, region, hint = app._parse_figure_key(key)
        self.assertEqual((n, region, hint), (7, [0.1, 0.2, 0.3, 0.4], "Fig 2"))

    def test_round_trip_without_region(self):
        _, key = app._vision_key(7, "", "Fig|2")     # hint에 '|'가 섞여도 보존
        n, region, hint = app._parse_figure_key(key)
        self.assertEqual((n, region, hint), (7, None, "Fig|2"))


class TestAnchor(unittest.TestCase):
    """문장 정렬 앵커쌍 정제 — 누락 필드가 None 으로 새면 프론트 매칭이 깨진다."""

    def test_missing_end_anchors_become_empty_strings(self):
        self.assertEqual(app._anchor({"s": "src", "t": "tgt"}),
                         {"s": "src", "se": "", "t": "tgt", "te": ""})

    def test_whitespace_is_stripped(self):
        self.assertEqual(app._anchor({"s": "  a  ", "t": "\tb\n"})["s"], "a")
        self.assertEqual(app._anchor({"s": "  a  ", "t": "\tb\n"})["t"], "b")

    def test_non_string_values_are_coerced(self):
        self.assertEqual(app._anchor({"s": 12, "t": None})["s"], "12")

    def test_empty_input_yields_all_empty(self):
        self.assertEqual(app._anchor({}), {"s": "", "se": "", "t": "", "te": ""})


class TestLibHit(unittest.TestCase):
    """심화 검색(OpenAlex) 결과가 이미 서재에 있는 논문인지 판정. 오탐하면 '서재에 있음'
    배지가 엉뚱한 논문을 가리키고, 누락하면 같은 논문을 또 받게 된다."""

    INDEX = [
        {"pid": "p1", "doi": "10.1038/nature14539", "sig": "deeplearning"},
        {"pid": "p2", "doi": "", "sig": "attentionisallyouneed"},
        {"pid": "p3", "doi": "10.1016/j.cej.2016.08.053",
         "sig": "roleofnanomaterialsinwatertreatmentapplicationsareview"},
    ]

    def test_doi_exact_match_wins(self):
        self.assertEqual(app._lib_hit("10.1038/nature14539", "무관한 제목", self.INDEX), "p1")

    def test_doi_partial_does_not_match(self):
        """_graph_edges 는 참고문헌 '문장' 안의 부분일치를 쓰지만, 여기는 doi 필드끼리라
        완전일치여야 한다 — 접두사가 같은 다른 논문을 잡으면 안 된다."""
        self.assertIsNone(app._lib_hit("10.1038/nature145", "무관한 제목", self.INDEX))

    def test_title_fallback_when_no_doi(self):
        self.assertEqual(app._lib_hit("", "Attention Is All You Need", self.INDEX), "p2")

    def test_title_match_ignores_punctuation_and_case(self):
        self.assertEqual(
            app._lib_hit("", "Role of nanomaterials in water treatment applications: A review",
                         self.INDEX), "p3")

    def test_short_title_never_matches(self):
        """15자 미만 시그니처는 우연 일치가 잦아 매칭에서 제외한다."""
        self.assertIsNone(app._lib_hit("", "Short", self.INDEX))

    def test_unknown_paper_returns_none(self):
        self.assertIsNone(
            app._lib_hit("10.9999/nope", "Totally Unrelated Paper About Something Else",
                         self.INDEX))


class TestOaSlim(unittest.TestCase):
    """OpenAlex 응답 → UI 필드. 실측에서 display_name 이 빈 레코드가 섞여 나왔다."""

    WORK = {
        "id": "https://openalex.org/W2741809807",
        "doi": "https://doi.org/10.1038/Nature14539",
        "display_name": "Deep learning",
        "publication_year": 2015,
        "cited_by_count": 82640,
        "primary_location": {"source": {"display_name": "Nature"}},
        "authorships": [{"author": {"display_name": "Yann LeCun"}},
                        {"author": {"display_name": "Yoshua Bengio"}},
                        {"author": {"display_name": "Geoffrey Hinton"}},
                        {"author": {"display_name": "Extra Person"}}],
    }

    def test_extracts_id_and_normalises_doi(self):
        s = app._oa_slim(self.WORK, [])
        self.assertEqual(s["oa_id"], "W2741809807")
        self.assertEqual(s["doi"], "10.1038/nature14539")

    def test_caps_authors_at_three(self):
        self.assertEqual(len(app._oa_slim(self.WORK, [])["authors"]), 3)

    def test_venue_from_primary_location(self):
        self.assertEqual(app._oa_slim(self.WORK, [])["venue"], "Nature")

    def test_missing_fields_do_not_raise(self):
        s = app._oa_slim({}, [])
        self.assertEqual(s["title"], "")
        self.assertEqual(s["cited_by_count"], 0)
        self.assertEqual(s["authors"], [])
        self.assertIsNone(s["in_library"])

    def test_in_library_flag_is_set(self):
        index = [{"pid": "p1", "doi": "10.1038/nature14539", "sig": "deeplearning"}]
        self.assertEqual(app._oa_slim(self.WORK, index)["in_library"], "p1")

    def test_clean_drops_untitled_records(self):
        works = [self.WORK, {"id": "https://openalex.org/W1", "display_name": ""},
                 {"id": "https://openalex.org/W2", "display_name": "   "}]
        out = app._oa_clean(works, [])
        self.assertEqual([w["oa_id"] for w in out], ["W2741809807"])


class TestCiteShort(unittest.TestCase):
    """근거 항목마다 붙는 짧은 출처. 저자가 없거나 연도가 없어도 빈칸·None 이 새면 안 된다."""

    def test_single_author_with_year(self):
        self.assertEqual(app._cite_short({"authors": ["Jane Kim"], "year": 2021}), "Kim (2021)")

    def test_multiple_authors_get_et_al(self):
        self.assertEqual(app._cite_short({"authors": ["Jane Kim", "Bo Lee"], "year": 2021}),
                         "Kim et al. (2021)")

    def test_comma_form_surname(self):
        self.assertEqual(app._cite_short({"authors": ["Kim, Jane"], "year": 1999}), "Kim (1999)")

    def test_no_year_drops_parens(self):
        self.assertEqual(app._cite_short({"authors": ["Jane Kim"]}), "Kim")

    def test_no_authors_falls_back_to_title(self):
        self.assertEqual(app._cite_short({"title": "Attention Is All You Need", "year": 2017}),
                         "Attention Is All You Need (2017)")

    def test_nothing_at_all(self):
        self.assertEqual(app._cite_short({}), "출처 미상")

    def test_non_latin_author_survives(self):
        """_split_author 의 이니셜 추출은 라틴 문자만 본다 — 성까지 날아가면 출처가 사라진다."""
        self.assertEqual(app._cite_short({"authors": ["김정은"], "year": 2020}), "김정은 (2020)")


class TestMergeSpans(unittest.TestCase):
    def test_merges_overlapping(self):
        self.assertEqual(app._merge_spans([(0, 8), (3, 11)]), [(0, 11)])

    def test_merges_touching(self):
        """[0,8) 과 [8,16) 은 초안에서 연속된 한 구간이다 — 두 줄로 쪼개 보고하면 안 된다."""
        self.assertEqual(app._merge_spans([(0, 8), (8, 16)]), [(0, 16)])

    def test_keeps_disjoint(self):
        self.assertEqual(app._merge_spans([(20, 28), (0, 8)]), [(0, 8), (20, 28)])

    def test_contained_span_vanishes(self):
        self.assertEqual(app._merge_spans([(0, 20), (5, 9)]), [(0, 20)])

    def test_empty(self):
        self.assertEqual(app._merge_spans([]), [])


class TestKpText(unittest.TestCase):
    """keypoints 는 시작·끝 앵커만 저장한다 — 본문에서 문장을 되살리지 못하면 근거 보드가 빈다."""

    ENTRY = {"pages": [(1, "Intro text here.", "intro text here."),
                       (2, "We trained a model on 12 datasets and it worked well. Next.",
                        "we trained a model on 12 datasets and it worked well. next.")]}

    def test_reconstructs_between_anchors(self):
        it = {"p": 2, "s": "We trained a model", "se": "worked well"}
        self.assertEqual(app._kp_text(self.ENTRY, it),
                         "We trained a model on 12 datasets and it worked well")

    def test_wrong_page_still_found(self):
        """AI 가 쪽 번호를 틀리는 경우가 있다 — 저장된 쪽에 없으면 나머지도 훑어야 한다."""
        it = {"p": 1, "s": "We trained a model", "se": "worked well"}
        self.assertEqual(app._kp_text(self.ENTRY, it),
                         "We trained a model on 12 datasets and it worked well")

    def test_missing_end_anchor_takes_a_slice(self):
        out = app._kp_text(self.ENTRY, {"p": 2, "s": "We trained a model", "se": ""})
        self.assertTrue(out.startswith("We trained a model"))

    def test_unfindable_falls_back_to_start_anchor(self):
        self.assertEqual(app._kp_text(self.ENTRY, {"p": 2, "s": "nowhere in text", "se": "x"}),
                         "nowhere in text")

    def test_no_start_anchor_is_empty(self):
        self.assertEqual(app._kp_text(self.ENTRY, {"p": 2, "s": "", "se": "x"}), "")


class TestFindOverlaps(unittest.TestCase):
    """서재를 훑는 부분은 파일시스템이 필요하지만, 어절 분해·구간 병합은 짧은 초안으로 확인된다."""

    def test_too_short_draft_returns_nothing(self):
        r = app._find_overlaps("짧은 초안 세 어절", k=8)
        self.assertEqual(r["hits"], [])
        self.assertEqual(r["matched"], 0)

    def test_counts_words_after_normalisation(self):
        """_norm_search 가 줄바꿈·연속 공백을 접는다 — 어절 수가 부풀면 겹침 비율이 낮게 나온다."""
        r = app._find_overlaps("a  b\nc   d e f g h i", k=8)
        self.assertEqual(r["words"], 9)


class TestNumberedRefs(unittest.TestCase):
    METAS = [{"id": "p1", "title": "First Paper", "authors": ["Jane Kim"], "year": 2020},
             {"id": "p2", "title": "Second Paper", "authors": ["Bo Lee", "Ann Park"], "year": 2021}]

    def test_numbers_follow_given_order(self):
        items = app._numbered_refs(self.METAS, "acs")
        self.assertEqual([i["n"] for i in items], [1, 2])
        self.assertEqual([i["pid"] for i in items], ["p1", "p2"])

    def test_reversing_input_reverses_numbers(self):
        """번호는 고른 순서 그대로여야 한다 — 서버가 제목·연도로 다시 정렬하면 안 된다."""
        items = app._numbered_refs(list(reversed(self.METAS)), "acs")
        self.assertEqual([i["pid"] for i in items], ["p2", "p1"])

    def test_style_selects_the_string(self):
        acs = app._numbered_refs(self.METAS, "acs")[0]["cite"]
        apa = app._numbered_refs(self.METAS, "apa")[0]["cite"]
        bib = app._numbered_refs(self.METAS, "bibtex")[0]["cite"]
        self.assertNotEqual(acs, apa)
        self.assertTrue(bib.startswith("@article{"))

    def test_short_form_is_attached(self):
        self.assertEqual(app._numbered_refs(self.METAS, "acs")[1]["short"], "Lee et al. (2021)")

    def test_empty_list(self):
        self.assertEqual(app._numbered_refs([], "acs"), [])


class TestEvKey(unittest.TestCase):
    """초안의 각 절이 이 키로 근거를 붙들고 있다 — 같은 근거는 다시 불러도 같은 키여야 한다."""

    def test_deterministic(self):
        self.assertEqual(app._ev_key("p1", "hl", "abc"), app._ev_key("p1", "hl", "abc"))

    def test_kind_changes_the_key(self):
        self.assertNotEqual(app._ev_key("p1", "hl", "abc"), app._ev_key("p1", "note", "abc"))

    def test_paper_changes_the_key(self):
        self.assertNotEqual(app._ev_key("p1", "hl", "abc"), app._ev_key("p2", "hl", "abc"))

    def test_shape_is_pid_kind_hash(self):
        parts = app._ev_key("58af0db8", "kp", "We trained").split(":")
        self.assertEqual(parts[0], "58af0db8")
        self.assertEqual(parts[1], "kp")
        self.assertEqual(len(parts[2]), 10)


class TestOverlapReporting(unittest.TestCase):
    def test_spots_counts_before_the_display_cap(self):
        """겹친 곳이 상한을 넘으면 목록은 잘리지만 개수는 진짜 값이어야 한다 —
        hits 만 세면 언제나 '60곳'이라 보고하게 된다."""
        r = app._find_overlaps("a b c d e f g h", k=4)
        self.assertIn("spots", r)
        self.assertGreaterEqual(r["spots"], len(r["hits"]))
        self.assertLessEqual(len(r["hits"]), app.OVERLAP_TOP)


class TestPruneDraftRefs(unittest.TestCase):
    """논문을 지우면 초안이 붙들던 그 논문 근거 키도 사라져야 한다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.orig = app.DRAFT
        app.DRAFT = Path(self.tmp.name) / "_draft.json"

    def tearDown(self):
        app.DRAFT = self.orig
        self.tmp.cleanup()

    def test_drops_only_the_deleted_papers_keys(self):
        app.write_json(app.DRAFT, {"title": "t", "sections": [
            {"id": "s0", "name": "서론", "text": "", "ev": ["aaa:hl:1", "bbb:hl:2", "aaa:kp:3"]},
            {"id": "s1", "name": "결론", "text": "", "ev": ["bbb:note:4"]}]})
        self.assertEqual(app._prune_draft_refs("aaa"), 2)
        left = app.read_json(app.DRAFT, {})["sections"]
        self.assertEqual(left[0]["ev"], ["bbb:hl:2"])
        self.assertEqual(left[1]["ev"], ["bbb:note:4"])

    def test_prefix_must_match_the_whole_id(self):
        """'aa' 를 지웠다고 'aaa:...' 가 같이 날아가면 안 된다 — 접두사에 콜론까지 붙여 비교한다."""
        app.write_json(app.DRAFT, {"title": "", "sections": [
            {"id": "s0", "name": "n", "text": "", "ev": ["aaa:hl:1"]}]})
        self.assertEqual(app._prune_draft_refs("aa"), 0)

    def test_no_draft_file_is_not_an_error(self):
        self.assertEqual(app._prune_draft_refs("aaa"), 0)

    def test_nothing_to_drop_leaves_the_file_alone(self):
        app.write_json(app.DRAFT, {"title": "", "sections": [
            {"id": "s0", "name": "n", "text": "keep", "ev": ["bbb:hl:1"]}]})
        before = app.DRAFT.read_text(encoding="utf-8")
        self.assertEqual(app._prune_draft_refs("aaa"), 0)
        self.assertEqual(app.DRAFT.read_text(encoding="utf-8"), before)


class TestCleanDraft(unittest.TestCase):
    def test_duplicate_section_ids_are_separated(self):
        """id 가 겹치면 '이 절에 담기'가 엉뚱한 절에 붙는다."""
        d = app._clean_draft({"sections": [{"id": "s1"}, {"id": "s1"}, {"id": "s1"}]})
        self.assertEqual([s["id"] for s in d["sections"]], ["s1", "s1_", "s1__"])

    def test_blank_id_gets_a_positional_one(self):
        d = app._clean_draft({"sections": [{"id": "  "}]})
        self.assertEqual(d["sections"][0]["id"], "s0")

    def test_blank_name_gets_a_placeholder(self):
        self.assertEqual(app._clean_draft({"sections": [{"id": "a"}]})["sections"][0]["name"],
                         "이름 없는 절")

    def test_evidence_keys_dedupe_and_keep_order(self):
        d = app._clean_draft({"sections": [{"id": "a", "ev": ["k2", "k1", "k2", "", "k3"]}]})
        self.assertEqual(d["sections"][0]["ev"], ["k2", "k1", "k3"])

    def test_section_cap(self):
        d = app._clean_draft({"sections": [{"id": f"s{i}"} for i in range(50)]})
        self.assertEqual(len(d["sections"]), app.DRAFT_MAX_SECTIONS)

    def test_text_is_truncated_not_dropped(self):
        d = app._clean_draft({"sections": [{"id": "a", "text": "x" * (app.DRAFT_MAX_TEXT + 500)}]})
        self.assertEqual(len(d["sections"][0]["text"]), app.DRAFT_MAX_TEXT)

    def test_non_dict_sections_are_skipped(self):
        d = app._clean_draft({"sections": ["oops", None, {"id": "a"}]})
        self.assertEqual([s["id"] for s in d["sections"]], ["a"])

    def test_empty_body(self):
        self.assertEqual(app._clean_draft({}), {"title": "", "sections": []})


class TestRehome(unittest.TestCase):
    """config.json 은 OneDrive 로 두 PC가 공유한다 — 저장된 절대경로의 사용자명이 이 PC와
    다를 때 같은 꼬리 경로를 이 PC 홈에서 찾아내는지."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        users = Path(self.tmp.name)
        self.home = users / "alice"                     # 이 PC
        (self.home / "OneDrive" / "Vault").mkdir(parents=True)
        (users / "other").mkdir()                       # 반대편 PC의 사용자 폴더(꼬리 없음)

    def tearDown(self):
        self.tmp.cleanup()

    def test_other_pc_path_is_rehomed(self):
        other = str(Path(self.tmp.name) / "other" / "OneDrive" / "Vault")
        self.assertEqual(app._rehome(other, self.home),
                         str(self.home / "OneDrive" / "Vault"))

    def test_existing_path_is_left_alone(self):
        """이 PC에서 이미 열리는 경로는 손대지 않는다 — 정션으로 이어둔 경우가 이쪽이다."""
        mine = str(self.home / "OneDrive" / "Vault")
        self.assertEqual(app._rehome(mine, self.home), mine)

    def test_missing_tail_returns_original(self):
        """되짚어도 없는 폴더면 원래 값을 돌려준다 — 오류 메시지가 사용자가 설정한 경로를 가리켜야 한다."""
        gone = str(Path(self.tmp.name) / "other" / "Zotero")
        self.assertEqual(app._rehome(gone, self.home), gone)

    def test_path_outside_users_root_is_untouched(self):
        self.assertEqual(app._rehome(r"D:\Data\Vault", self.home), r"D:\Data\Vault")

    def test_user_folder_itself_has_no_tail(self):
        bare = str(Path(self.tmp.name) / "other")
        self.assertEqual(app._rehome(bare, self.home), bare)

    def test_blank_stays_blank(self):
        self.assertEqual(app._rehome("", self.home), "")
        self.assertEqual(app._rehome(None, self.home), "")
        self.assertEqual(app._rehome("   ", self.home), "")


class TestRefDoi(unittest.TestCase):
    """참고문헌 문자열에서 DOI 뽑기 — 문장부호를 같이 물고 오면 조회가 통째로 404가 난다."""

    def test_plain(self):
        self.assertEqual(app._ref_doi("Kim, J. Nature 2019, 10.1038/s41586-019-1234-5"),
                         "10.1038/s41586-019-1234-5")

    def test_trailing_period_is_not_part_of_the_doi(self):
        self.assertEqual(app._ref_doi("... doi:10.1021/acs.est.0c01234."), "10.1021/acs.est.0c01234")

    def test_url_form(self):
        self.assertEqual(app._ref_doi("https://doi.org/10.1016/j.watres.2021.117000"),
                         "10.1016/j.watres.2021.117000")

    def test_wrapped_in_parens(self):
        self.assertEqual(app._ref_doi("(doi: 10.1002/adma.202100000)"), "10.1002/adma.202100000")

    def test_lowercased(self):
        self.assertEqual(app._ref_doi("10.1038/S41586-019-1234-5"), "10.1038/s41586-019-1234-5")

    def test_none_found(self):
        self.assertEqual(app._ref_doi("Smith, A. Some Journal, 2020, 12, 34-56."), "")
        self.assertEqual(app._ref_doi(None), "")


class TestArxivDoi(unittest.TestCase):
    """arXiv 번호만 적힌 인용 — 10.48550/arXiv.<id> 로 바꾸면 OpenAlex가 그대로 찾아준다."""

    def test_preprint_form(self):
        self.assertEqual(app._arxiv_doi("Layer normalization. arXiv preprint arXiv:1607.06450, 2016."),
                         "10.48550/arxiv.1607.06450")

    def test_version_suffix_is_dropped(self):
        self.assertEqual(app._arxiv_doi("arXiv:1409.0473v7"), "10.48550/arxiv.1409.0473")

    def test_five_digit_sequence(self):
        self.assertEqual(app._arxiv_doi("arXiv:2301.12345"), "10.48550/arxiv.2301.12345")

    def test_case_and_spacing(self):
        self.assertEqual(app._arxiv_doi("ARXIV: 1412.6980"), "10.48550/arxiv.1412.6980")

    def test_no_arxiv_id(self):
        self.assertEqual(app._arxiv_doi("Kingma & Ba. Adam. In ICLR, 2015."), "")
        self.assertEqual(app._arxiv_doi(None), "")


class TestRefTitleOk(unittest.TestCase):
    """OpenAlex 검색은 무엇을 넣든 무언가를 돌려준다 — 제목 포함 확인이 유일한 방어선이다."""

    REF = ("[3] Zhang, Y.; Li, Q. Enzymatic depolymerization of polyethylene "
           "terephthalate at ambient temperature. Nature 2022, 604, 662-667.")

    def test_matching_title_passes(self):
        self.assertTrue(app._ref_title_ok(
            self.REF, "Enzymatic depolymerization of polyethylene terephthalate at ambient temperature"))

    def test_punctuation_and_case_do_not_matter(self):
        self.assertTrue(app._ref_title_ok(
            self.REF, "ENZYMATIC, DEPOLYMERIZATION: of polyethylene terephthalate at ambient temperature!"))

    def test_unrelated_title_fails(self):
        self.assertFalse(app._ref_title_ok(self.REF, "A completely different paper about neural networks"))

    def test_short_title_is_rejected_even_if_contained(self):
        """15자 미만 제목은 우연히 포함될 수 있어 신뢰하지 않는다."""
        self.assertFalse(app._ref_title_ok(self.REF, "Nature"))

    def test_empty(self):
        self.assertFalse(app._ref_title_ok(self.REF, ""))
        self.assertFalse(app._ref_title_ok("", "Some fairly long paper title here"))


class TestGraphEdgesVerified(unittest.TestCase):
    """검증된 DOI가 붙으면 매칭이 완전일치로 올라간다. 옛 형태(문자열 refs)도 계속 돌아야 한다."""

    A = {"id": "aaaaaaaa", "title": "Paper A about plasma degradation of plastics",
         "doi": "10.1000/aaa", "refs": []}

    def test_string_refs_still_work(self):
        b = {"id": "bbbbbbbb", "title": "Paper B", "doi": "10.1000/bbb",
             "refs": ["Someone. Paper A about plasma degradation of plastics. 2020."]}
        e = app._graph_edges([self.A, b])
        self.assertEqual(e, [{"from": "bbbbbbbb", "to": "aaaaaaaa", "why": "title"}])

    def test_verified_doi_wins_and_is_labelled(self):
        b = {"id": "bbbbbbbb", "title": "Paper B", "doi": "10.1000/bbb",
             "refs": [{"text": "제목이 전혀 다르게 적힌 줄", "oa": {"doi": "10.1000/aaa"}}]}
        e = app._graph_edges([self.A, b])
        self.assertEqual(e, [{"from": "bbbbbbbb", "to": "aaaaaaaa", "why": "doi_verified"}])

    def test_unverified_dict_falls_back_to_text(self):
        b = {"id": "bbbbbbbb", "title": "Paper B", "doi": "10.1000/bbb",
             "refs": [{"text": "Someone. 10.1000/aaa. 2020.", "oa": None}]}
        self.assertEqual(app._graph_edges([self.A, b])[0]["why"], "doi")

    def test_no_self_edges(self):
        a = {**self.A, "refs": [{"text": "Paper A about plasma degradation of plastics",
                                 "oa": {"doi": "10.1000/aaa"}}]}
        self.assertEqual(app._graph_edges([a]), [])


class TestWikilinks(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(app._wikilinks("[[PET 분해]]와 [[저온 플라즈마]]를 비교"),
                         ["PET 분해", "저온 플라즈마"])

    def test_alias_form_keeps_target(self):
        self.assertEqual(app._wikilinks("[[저온 플라즈마|NTP]]"), ["저온 플라즈마"])

    def test_dedupes_case_and_space_insensitively(self):
        self.assertEqual(app._wikilinks("[[PET]] [[pet]] [[ PET ]]"), ["PET"])

    def test_no_links(self):
        self.assertEqual(app._wikilinks("그냥 메모"), [])
        self.assertEqual(app._wikilinks(None), [])

    def test_unclosed_bracket_is_not_a_link(self):
        self.assertEqual(app._wikilinks("[[열린 채로"), [])


class TestCiteMarks(unittest.TestCase):
    def test_author_year(self):
        self.assertEqual(app._cite_marks("앞선 연구(Kim et al., 2021)에 따르면")["authoryear"], 1)

    def test_author_year_with_page(self):
        self.assertEqual(app._cite_marks("(Kim et al., 2021, p.4)")["total"], 1)

    def test_numeric_and_ranges(self):
        m = app._cite_marks("선행 연구[1] 및 후속 연구[2, 3] 그리고 [4-6]")
        self.assertEqual(m["numeric"], 3)

    def test_plain_parenthesis_is_not_a_citation(self):
        self.assertEqual(app._cite_marks("(그리고 이것은 그냥 괄호다)")["total"], 0)

    def test_bare_year_in_prose_is_not_counted(self):
        self.assertEqual(app._cite_marks("2021년에 발표된 논문이다")["total"], 0)


class TestSentences(unittest.TestCase):
    def test_splits_on_terminators(self):
        self.assertEqual(len(app._sentences("첫 문장이다. 둘째 문장이다! 셋째인가?")), 3)

    def test_line_without_terminator_still_counts(self):
        """제목·목록 항목도 인용 밀도의 분모다 — 빼면 밀도가 실제보다 높게 나온다."""
        self.assertEqual(len(app._sentences("## 소제목\n본문이다.")), 2)

    def test_et_al_period_does_not_end_a_sentence(self):
        """인용 표기의 마침표까지 세면 인용을 잘 단 글일수록 밀도가 낮게 나온다."""
        self.assertEqual(len(app._sentences("앞선 연구(Kim et al., 2021)가 보고했다. 그 뒤 확인됐다.")), 2)

    def test_decimal_point_does_not_end_a_sentence(self):
        self.assertEqual(len(app._sentences("분해율은 92.4%였다.")), 1)

    def test_eg_and_fig_are_protected(self):
        self.assertEqual(len(app._sentences("조건(e.g. 30 W)에서 Fig. 3처럼 나타났다.")), 1)

    def test_blank(self):
        self.assertEqual(app._sentences(""), [])


class TestUncitedEvidence(unittest.TestCase):
    EV = [{"cite": "Kim et al. (2021)", "text": "PET 분해율 92%"},
          {"cite": "Zhang (2019)", "text": "방전 전력 30 W"}]

    def test_flags_only_the_one_not_in_the_text(self):
        out = app._uncited_evidence("앞선 연구(Kim et al., 2021)는 92%를 보고했다.", self.EV)
        self.assertEqual([u["cite"] for u in out], ["Zhang (2019)"])

    def test_year_alone_is_not_enough(self):
        """연도만 맞고 저자가 없으면 다른 출처를 인용한 것이다."""
        out = app._uncited_evidence("2021년 연구에서는 92%였다.", self.EV[:1])
        self.assertEqual(len(out), 1)

    def test_surname_and_year_in_any_notation(self):
        out = app._uncited_evidence("Kim 등은 2021년에 이를 보고했다.", self.EV[:1])
        self.assertEqual(out, [])

    def test_blank_cite_is_skipped(self):
        self.assertEqual(app._uncited_evidence("본문", [{"cite": "  ", "text": "x"}]), [])

    def test_non_dict_entries_are_skipped(self):
        self.assertEqual(app._uncited_evidence("본문", ["oops", None]), [])


class TestTermConflicts(unittest.TestCase):
    CANON = {"non-thermal plasma": "저온 플라즈마"}
    ALTS = {"non-thermal plasma": ["저온 플라즈마", "비열 플라즈마", "논서멀 플라즈마"]}

    def test_flags_other_translation(self):
        out = app._term_conflicts("비열 플라즈마를 사용했다.", self.CANON, self.ALTS)
        self.assertEqual(out[0]["used"], ["비열 플라즈마"])
        self.assertFalse(out[0]["fixed"])

    def test_mixed_use_is_marked(self):
        out = app._term_conflicts("저온 플라즈마와 비열 플라즈마", self.CANON, self.ALTS)
        self.assertTrue(out[0]["fixed"])

    def test_canon_only_is_clean(self):
        self.assertEqual(app._term_conflicts("저온 플라즈마만 썼다", self.CANON, self.ALTS), [])

    def test_unfixed_terms_are_ignored(self):
        self.assertEqual(app._term_conflicts("비열 플라즈마", {}, self.ALTS), [])


class TestReviewChecks(unittest.TestCase):
    def test_density_and_counts(self):
        r = app._review_checks("첫 문장(Kim et al., 2021)이다. 둘째 문장이다.",
                               [{"cite": "Kim et al. (2021)", "text": "x"}], {}, {})
        self.assertEqual(r["sentences"], 2)
        self.assertEqual(r["cites"]["total"], 1)
        self.assertEqual(r["density"], 0.5)
        self.assertEqual(r["uncited"], [])

    def test_empty_text_does_not_divide_by_zero(self):
        self.assertEqual(app._review_checks("", [], {}, {})["density"], 0.0)


class TestCleanAnalysis(unittest.TestCase):
    def test_always_eight_slots_in_fixed_order(self):
        out = app._clean_analysis({"method": "이렇게 했다"})
        self.assertEqual([s["key"] for s in out], [k for k, _ in app.ANALYSIS_SECTIONS])
        self.assertEqual(out[3]["body"], "이렇게 했다")
        self.assertEqual(out[0]["body"], "")

    def test_list_value_becomes_a_markdown_list(self):
        out = app._clean_analysis({"limits": ["샘플 수 부족", "장기 안정성 미검증"]})
        body = next(s["body"] for s in out if s["key"] == "limits")
        self.assertEqual(body, "- 샘플 수 부족\n- 장기 안정성 미검증")

    def test_long_body_is_truncated(self):
        out = app._clean_analysis({"data": "가" * (app.ANALYSIS_MAX + 100)})
        self.assertEqual(len(next(s["body"] for s in out if s["key"] == "data")), app.ANALYSIS_MAX)

    def test_garbage_input_still_returns_eight_empty_slots(self):
        out = app._clean_analysis(["not", "a", "dict"])
        self.assertEqual(len(out), 8)
        self.assertTrue(all(s["body"] == "" for s in out))


class TestCleanReadPos(unittest.TestCase):
    """진행률은 서가에 막대로 그려진다 — 1을 넘긴 값이 저장되면 눈에 바로 띈다."""

    def test_valid(self):
        self.assertEqual(app._clean_read_pos({"p": 4, "r": 0.123456}), {"p": 4, "r": 0.1235})

    def test_rejects_out_of_range_ratio(self):
        self.assertIsNone(app._clean_read_pos({"p": 1, "r": 1.4}))
        self.assertIsNone(app._clean_read_pos({"p": 1, "r": -0.1}))

    def test_rejects_bad_page(self):
        self.assertIsNone(app._clean_read_pos({"p": 0, "r": 0.5}))

    def test_rejects_garbage(self):
        self.assertIsNone(app._clean_read_pos(None))
        self.assertIsNone(app._clean_read_pos("nope"))
        self.assertIsNone(app._clean_read_pos({"p": "x", "r": "y"}))


class _TempLib(unittest.TestCase):
    """app.LIB 를 임시 폴더로 갈아 끼운다 — 사용자의 실제 서재를 건드리지 않는다."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.real_lib = app.LIB
        app.LIB = Path(self.tmp.name)

    def tearDown(self):
        app.LIB = self.real_lib
        self.tmp.cleanup()

    def paper(self, pid, **meta):
        import json as _json
        d = app.LIB / pid
        d.mkdir(parents=True, exist_ok=True)
        (d / "meta.json").write_text(_json.dumps({"id": pid, **meta}), encoding="utf-8")
        return d

    def sidecar(self, d, name, data):
        import json as _json
        (d / name).write_text(_json.dumps(data), encoding="utf-8")


class TestNearDups(_TempLib):
    def test_doi_match(self):
        self.paper("aaaaaaaa", title="Alpha study of things", doi="10.1/x")
        self.paper("bbbbbbbb", title="완전히 다른 제목", doi="10.1/X")
        out = app._near_dups("aaaaaaaa", {"title": "Alpha study of things", "doi": "10.1/x"})
        self.assertEqual([(o["pid"], o["why"]) for o in out], [("bbbbbbbb", "doi")])

    def test_title_match_when_no_doi(self):
        self.paper("aaaaaaaa", title="Enzymatic depolymerization of PET at ambient temperature")
        self.paper("bbbbbbbb", title="Enzymatic depolymerization of PET at ambient temperature (preprint)")
        out = app._near_dups("aaaaaaaa", {"title": "Enzymatic depolymerization of PET at ambient temperature"})
        self.assertEqual([o["why"] for o in out], ["title"])

    def test_never_matches_itself(self):
        self.paper("aaaaaaaa", title="Alpha study of things here", doi="10.1/x")
        self.assertEqual(app._near_dups("aaaaaaaa", {"title": "Alpha study of things here", "doi": "10.1/x"}), [])

    def test_short_title_without_doi_is_not_enough(self):
        """15자 미만 제목은 우연히 겹친다 — 근거로 삼지 않는다."""
        self.paper("bbbbbbbb", title="Notes")
        self.assertEqual(app._near_dups("aaaaaaaa", {"title": "Notes"}), [])


class TestReviewQueue(_TempLib):
    NOW = 1_800_000_000

    def test_only_papers_with_marks(self):
        d = self.paper("aaaaaaaa", title="표시 있음", read_at=self.NOW - 60 * 86400)
        self.sidecar(d, "notes.json", [{"id": "n1", "quote": "q"}])
        self.paper("bbbbbbbb", title="표시 없음", read_at=self.NOW - 60 * 86400)
        out = app._review_queue(self.NOW)
        self.assertEqual([q["pid"] for q in out], ["aaaaaaaa"])

    def test_recent_papers_are_skipped(self):
        d = self.paper("aaaaaaaa", title="어제 봄", read_at=self.NOW - 86400)
        self.sidecar(d, "notes.json", [{"id": "n1", "quote": "q"}])
        self.assertEqual(app._review_queue(self.NOW), [])

    def test_sorted_by_marks_then_oldest(self):
        d1 = self.paper("aaaaaaaa", title="하나", read_at=self.NOW - 40 * 86400)
        self.sidecar(d1, "notes.json", [{"id": "n1", "quote": "q"}])
        d2 = self.paper("bbbbbbbb", title="셋", read_at=self.NOW - 35 * 86400)
        self.sidecar(d2, "highlights.json", {"items": [{"id": "h1"}, {"id": "h2"}, {"id": "h3"}]})
        self.assertEqual([q["pid"] for q in app._review_queue(self.NOW)], ["bbbbbbbb", "aaaaaaaa"])

    def test_falls_back_to_added_when_never_opened(self):
        d = self.paper("aaaaaaaa", title="연 적 없음", added=self.NOW - 90 * 86400)
        self.sidecar(d, "notes.json", [{"id": "n1", "quote": "q"}])
        self.assertEqual(app._review_queue(self.NOW)[0]["days"], 90)


class TestPendingPages(_TempLib):
    def test_only_untranslated_pages(self):
        d = self.paper("aaaaaaaa", title="x")
        self.sidecar(d, "text.json", {"pages": [{"n": 1, "text": "a"}, {"n": 2, "text": "b"},
                                                {"n": 3, "text": "c"}]})
        self.sidecar(d, "translation.json", {"pages": {"2": "이미"}})
        self.assertEqual(app._pending_pages("aaaaaaaa"), [1, 3])

    def test_no_text_means_nothing_to_do(self):
        self.paper("aaaaaaaa", title="x")
        self.assertEqual(app._pending_pages("aaaaaaaa"), [])


class TestParseInlineCites(unittest.TestCase):
    def test_author_year_page(self):
        c = app._parse_inline_cites("앞선 연구(Kim et al., 2021, p.4)에서")[0]
        self.assertEqual((c["who"], c["year"], c["page"]), ("kim", "2021", 4))

    def test_page_optional(self):
        self.assertEqual(app._parse_inline_cites("(Zhang, 2019)")[0]["page"], 0)

    def test_pp_form(self):
        self.assertEqual(app._parse_inline_cites("(Zhang, 2019, pp. 12)")[0]["page"], 12)

    def test_plain_parenthesis_ignored(self):
        self.assertEqual(app._parse_inline_cites("(그냥 괄호다)"), [])


class TestCheckInlineCites(unittest.TestCase):
    INDEX = [{"pid": "aaaaaaaa", "who": "kim", "year": "2021", "pages": 10, "title": "Kim 논문"}]

    def test_page_beyond_the_paper(self):
        out = app._check_inline_cites("(Kim et al., 2021, p.99)", self.INDEX, {("aaaaaaaa", 99)})
        self.assertEqual(out[0]["kind"], "page_range")

    def test_page_without_evidence(self):
        out = app._check_inline_cites("(Kim et al., 2021, p.4)", self.INDEX, {("aaaaaaaa", 7)})
        self.assertEqual(out[0]["kind"], "no_evidence")

    def test_page_with_evidence_is_clean(self):
        self.assertEqual(app._check_inline_cites("(Kim et al., 2021, p.4)", self.INDEX, {("aaaaaaaa", 4)}), [])

    def test_paper_outside_library_is_information_not_error(self):
        out = app._check_inline_cites("(Vaswani et al., 2017)", self.INDEX, {("aaaaaaaa", 4)})
        self.assertEqual(out[0]["kind"], "outside")

    def test_no_evidence_pages_skips_the_evidence_check(self):
        """옛 클라이언트가 쪽을 안 보내면 근거 대조는 건너뛴다 — 전부 오류로 보이면 안 된다."""
        self.assertEqual(app._check_inline_cites("(Kim et al., 2021, p.4)", self.INDEX, set()), [])


class TestCleanMindmap(unittest.TestCase):
    def test_root_is_always_first(self):
        out = app._clean_mindmap([], "제목")
        self.assertEqual([(n["id"], n["depth"]) for n in out], [("n0", 0)])

    def test_builds_depth_and_keeps_children(self):
        out = app._clean_mindmap([
            {"id": "a", "parent": "n0", "label": "축", "c": "met", "p": 2, "s": "start", "se": "end"},
            {"id": "b", "parent": "a", "label": "근거", "c": "res", "p": 3, "s": "s2", "se": "e2"},
        ], "제목")
        self.assertEqual([(n["id"], n["depth"]) for n in out], [("n0", 0), ("a", 1), ("b", 2)])

    def test_unknown_parent_reattaches_to_root(self):
        out = app._clean_mindmap([{"id": "a", "parent": "없는id", "label": "축"}], "제목")
        self.assertEqual(out[1]["parent"], "n0")

    def test_cycle_is_dropped(self):
        """뿌리에서 못 닿는 마디는 떨어져 나간다 — 순환이 하나만 있어도 각도 배분이 안 끝난다."""
        out = app._clean_mindmap([
            {"id": "a", "parent": "b", "label": "A"},
            {"id": "b", "parent": "a", "label": "B"},
        ], "제목")
        self.assertEqual([n["id"] for n in out], ["n0", "a", "b"])   # a 가 뿌리로 붙고 b 는 a 밑으로

    def test_self_parent_reattaches(self):
        out = app._clean_mindmap([{"id": "a", "parent": "a", "label": "A"}], "제목")
        self.assertEqual(out[1]["parent"], "n0")

    def test_depth_cap(self):
        raw = [{"id": f"n{i}", "parent": f"n{i-1}" if i > 1 else "n0", "label": f"L{i}"}
               for i in range(1, 8)]
        out = app._clean_mindmap(raw, "제목")
        self.assertLessEqual(max(n["depth"] for n in out), app.MINDMAP_MAX_DEPTH)

    def test_node_cap(self):
        raw = [{"id": f"x{i}", "parent": "n0", "label": f"L{i}"} for i in range(200)]
        self.assertLessEqual(len(app._clean_mindmap(raw, "제목")), app.MINDMAP_MAX_NODES)

    def test_unknown_category_becomes_idea(self):
        out = app._clean_mindmap([{"id": "a", "parent": "n0", "label": "A", "c": "wat"}], "제목")
        self.assertEqual(out[1]["c"], "idea")

    def test_blank_label_is_dropped(self):
        out = app._clean_mindmap([{"id": "a", "parent": "n0", "label": "   "}], "제목")
        self.assertEqual(len(out), 1)

    def test_duplicate_ids_do_not_collide(self):
        out = app._clean_mindmap([{"id": "a", "parent": "n0", "label": "A"},
                                  {"id": "a", "parent": "n0", "label": "B"}], "제목")
        self.assertEqual(len({n["id"] for n in out}), 3)

    def test_garbage_input(self):
        self.assertEqual(len(app._clean_mindmap("nope", "제목")), 1)


try:
    import docx as _docx           # noqa: F401
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False


@unittest.skipUnless(HAS_DOCX, "python-docx 미설치 — .docx 내보내기는 선택 의존성이다")
class TestBuildDraftDocx(unittest.TestCase):
    DRAFT = {"title": "테스트 원고", "sections": [
        {"id": "s0", "name": "서론", "text": "첫 문단.\n\n둘째 문단.", "ev": ["k1"]},
        {"id": "s1", "name": "본론", "text": "", "ev": []}]}
    EV = {"k1": {"key": "k1", "cite": "Kim et al. (2021)", "page": 4,
                 "text": "PET 표면 산화", "memo": "핵심"}}
    METAS = [{"id": "x", "title": "A study of things", "authors": ["Kim, J."],
              "year": 2021, "venue": "Nature", "doi": "10.1/x"}]

    def texts(self, blob):
        import io
        import re
        import zipfile
        xml = zipfile.ZipFile(io.BytesIO(blob)).read("word/document.xml").decode("utf-8")
        return re.findall(r"<w:t[^>]*>([^<]+)</w:t>", xml)

    def test_body_sections_and_evidence(self):
        t = self.texts(app._build_draft_docx(self.DRAFT, self.EV, self.METAS, "acs"))
        self.assertIn("테스트 원고", t)
        self.assertIn("서론", t)
        self.assertIn("첫 문단.", t)
        self.assertIn("둘째 문단.", t)
        self.assertIn("PET 표면 산화", t)

    def test_references_are_rendered_strings_not_dicts(self):
        """_numbered_refs 는 dict 를 돌려준다 — 그대로 문단에 넣으면 키 이름이 찍힌다."""
        t = self.texts(app._build_draft_docx(self.DRAFT, self.EV, self.METAS, "acs"))
        joined = " ".join(t)
        self.assertIn("[1]", joined)
        self.assertIn("A study of things", joined)
        self.assertNotIn("npidtitleshortcite", joined)

    def test_no_evidence_no_reference_section(self):
        bare = {"title": "빈 원고", "sections": [{"id": "s0", "name": "서론", "text": "본문", "ev": []}]}
        joined = " ".join(self.texts(app._build_draft_docx(bare, {}, [], "acs")))
        self.assertNotIn("담은 근거", joined)
        self.assertNotIn("참고문헌", joined)


class TestDocxParagraphs(unittest.TestCase):
    def test_blank_line_splits_paragraphs(self):
        class FakeDoc:
            def __init__(self): self.out = []
            def add_paragraph(self, t): self.out.append(t)
        d = FakeDoc()
        app._docx_paragraphs(d, "  하나  \n\n  둘\n셋  \n\n\n")
        self.assertEqual(d.out, ["하나", "둘\n셋"])

    def test_empty_text_adds_nothing(self):
        class FakeDoc:
            def __init__(self): self.out = []
            def add_paragraph(self, t): self.out.append(t)
        d = FakeDoc()
        app._docx_paragraphs(d, "   ")
        self.assertEqual(d.out, [])


class TestTopTopics(unittest.TestCase):
    def test_sorted_by_papers_then_name(self):
        counts = {"T1": {"id": "T1", "name": "zeta", "papers": 2},
                  "T2": {"id": "T2", "name": "alpha", "papers": 2},
                  "T3": {"id": "T3", "name": "beta", "papers": 5}}
        self.assertEqual([t["id"] for t in app._top_topics(counts)], ["T3", "T2", "T1"])

    def test_limit(self):
        counts = {f"T{i}": {"id": f"T{i}", "name": f"n{i}", "papers": i} for i in range(10)}
        self.assertEqual(len(app._top_topics(counts, 3)), 3)

    def test_empty(self):
        self.assertEqual(app._top_topics({}), [])


class TestZoteroBiblio(unittest.TestCase):
    """Zotero 가져오기의 서지 흡수 — date 필드는 형식이 제각각이라 연도만 방어적으로 뽑는다."""

    def test_year_from_iso(self):
        self.assertEqual(app._zot_year("2020-05-01"), 2020)

    def test_year_from_freeform(self):
        self.assertEqual(app._zot_year("May 2017"), 2017)

    def test_year_out_of_range_or_absent(self):
        self.assertIsNone(app._zot_year("1776"))
        self.assertIsNone(app._zot_year(""))
        self.assertIsNone(app._zot_year(None))


class TestZoteroAnnotations(unittest.TestCase):
    def test_norm_matches_pdf_artifacts(self):
        """줄바꿈 하이픈·리가처·공백이 달라도 같은 문장은 같은 키."""
        self.assertEqual(app._norm_hl_text("chain scis-\nsion of ﬁlms"),
                         app._norm_hl_text("chain scission of films"))

    def test_page_from_position_index(self):
        self.assertEqual(app._zot_ann_page('{"pageIndex": 3}', "12"), 4)

    def test_page_falls_back_to_label(self):
        self.assertEqual(app._zot_ann_page("not json", "12"), 12)
        self.assertEqual(app._zot_ann_page(None, None), 0)


class TestCitekeyCitations(unittest.TestCase):
    """citekey 인용 모드 — [@key, p.N] 이 채점·무결성 검사에서 1급 표기로 취급돼야 한다."""

    INDEX = [{"pid": "aaaaaaaa", "who": "kim", "year": "2021", "citekey": "kim2021attention",
              "pages": 12, "title": "T"}]

    def test_bibtex_key_prefers_zotero_citekey(self):
        self.assertEqual(app._bibtex_key({"citekey": "kim2021attention",
                                          "authors": ["Lee, Bo"], "year": 1999, "title": "Other"}),
                         "kim2021attention")

    def test_bibtex_key_falls_back_without_citekey(self):
        self.assertEqual(app._bibtex_key({"authors": ["Jane Kim"], "year": 2021,
                                          "title": "The Attention Paper"}), "kim2021attention")

    def test_cite_marks_counts_citekey(self):
        m = app._cite_marks("본문 [@kim2021attention, p.4] 와 (Lee, 2020) 와 [3]")
        self.assertEqual((m["citekey"], m["authoryear"], m["numeric"], m["total"]), (1, 1, 1, 3))

    def test_parse_inline_citekey(self):
        c = next(c for c in app._parse_inline_cites("[@kim2021attention, p.4]") if c.get("citekey"))
        self.assertEqual((c["citekey"], c["page"]), ("kim2021attention", 4))

    def test_check_citekey_hits_library(self):
        self.assertEqual(app._check_inline_cites("[@kim2021attention, p.4]",
                                                 self.INDEX, {("aaaaaaaa", 4)}), [])

    def test_check_citekey_page_range(self):
        out = app._check_inline_cites("[@kim2021attention, p.99]", self.INDEX, set())
        self.assertEqual(out[0]["kind"], "page_range")

    def test_check_unknown_citekey_is_outside(self):
        out = app._check_inline_cites("[@nobody2020]", self.INDEX, set())
        self.assertEqual(out[0]["kind"], "outside")

    def test_uncited_evidence_sees_citekey_use(self):
        ev = [{"cite": "Kim et al. (2021)", "citekey": "kim2021attention", "text": "t"}]
        self.assertEqual(app._uncited_evidence("근거는 [@kim2021attention]이다", ev), [])
        self.assertEqual(len(app._uncited_evidence("인용 없음", ev)), 1)


class TestVaultMemo(unittest.TestCase):
    """Obsidian 노트 역방향 검색 — 관리블록 밖 사용자 영역만 색인해야 한다(안이면 중복 색인)."""

    def test_extracts_user_area_only(self):
        p = Path(tempfile.mkdtemp()) / "n.md"
        p.write_text("frontmatter\nAUTO 내용 사본\n" + app.AUTO_END +
                     "\n## 내 메모\n여기가 내 메모다\n", encoding="utf-8")
        self.assertEqual(app._vault_memo_text(p), "여기가 내 메모다")

    def test_no_marker_means_empty(self):
        p = Path(tempfile.mkdtemp()) / "n.md"
        p.write_text("사용자 소유 노트 — achird 관리블록 없음", encoding="utf-8")
        self.assertEqual(app._vault_memo_text(p), "")

    def test_missing_file_empty(self):
        self.assertEqual(app._vault_memo_text(Path(tempfile.mkdtemp()) / "no.md"), "")


class TestPrepStatus(unittest.TestCase):
    """자동 준비 체인의 멱등 판정 — 사이드카 실물이 곧 완료 상태다."""

    def test_empty_dir_all_pending(self):
        d = Path(tempfile.mkdtemp())
        st = app._prep_status(d)
        self.assertEqual(set(st), set(app.PREP_STEPS))
        self.assertFalse(any(st.values()))

    def test_sidecars_mark_done(self):
        import json as _j
        d = Path(tempfile.mkdtemp())
        (d / "text.json").write_text('{"pages": [{"n": 1, "text": "x"}]}', encoding="utf-8")
        (d / "summary.md").write_text("요약", encoding="utf-8")
        (d / "meta.json").write_text(_j.dumps({"authors": ["Kim"]}), encoding="utf-8")
        (d / "keypoints.json").write_text('{"items": [{"c": "nov"}]}', encoding="utf-8")
        (d / "refs.json").write_text('{"items": [], "verified_ts": 1}', encoding="utf-8")
        st = app._prep_status(d)
        self.assertTrue(all(st[k] for k in ("text", "meta", "summary", "keypoints", "refs")))
        self.assertFalse(st["glossary"] or st["questions"])

    def test_zotero_meta_counts_as_done(self):
        """Zotero 가 서지를 채웠으면 AI 재추출 단계는 건너뛴다."""
        import json as _j
        d = Path(tempfile.mkdtemp())
        (d / "meta.json").write_text(_j.dumps({"doi": "10.1/x"}), encoding="utf-8")
        self.assertTrue(app._prep_status(d)["meta"])


class TestZoteroSaveItem(unittest.TestCase):
    def test_builds_connector_item(self):
        it = app._zot_save_item({"title": "T", "authors": ["Kim, Jane", "Bo Lee"],
                                 "year": 2021, "venue": "V", "doi": "10.1/x",
                                 "url": "https://e.g", "abstract": "A"})
        self.assertEqual(it["itemType"], "journalArticle")
        self.assertEqual(it["creators"][0], {"lastName": "Kim", "firstName": "Jane",
                                             "creatorType": "author"})
        self.assertEqual(it["creators"][1]["lastName"], "Lee")
        self.assertEqual((it["date"], it["publicationTitle"], it["DOI"]), ("2021", "V", "10.1/x"))

    def test_missing_fields_omitted(self):
        it = app._zot_save_item({"title": "T"})
        for k in ("creators", "date", "publicationTitle", "DOI", "url", "abstractNote"):
            self.assertNotIn(k, it)


if __name__ == "__main__":
    unittest.main(verbosity=2)
