from schema.apply import table_names


def test_table_names_dict_result():
    assert table_names({"tables": {"chat": {}, "memory": {}}}) == ["chat", "memory"]


def test_table_names_list_wrapped_result():
    assert table_names([{"tables": {"chat": {}, "memory": {}}}]) == ["chat", "memory"]


def test_table_names_empty_list():
    assert table_names([]) == []


def test_table_names_none():
    assert table_names(None) == []


def test_table_names_dict_without_tables():
    assert table_names({"other": {}}) == []
