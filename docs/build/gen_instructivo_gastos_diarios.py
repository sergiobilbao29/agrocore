# -*- coding: utf-8 -*-
"""Instructivo: Gastos diarios — circuito completo (categorias, carga y reporte por categoria)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Gastos-Diarios.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
RED_BG = colors.HexColor("#fee2e2"); RED_BD = colors.HexColor("#ef4444"); RED_TX = colors.HexColor("#991b1b")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Gastos diarios", st_title))
    E.append(Paragraph("De la categoria al reporte: cargar los gastos del dia a dia y ver mes a mes cuanto, de quien y de que son", st_sub))
    E.append(Paragraph(
        "Todos los dias hay gastos chicos y medianos: combustible, comida del equipo, repuestos, un flete, un adelanto, "
        "servicios... En AgroCore se cargan en un solo lugar, <b>Movimientos diarios</b>, eligiendo la <b>categoria</b> del "
        "gasto y <b>de quien</b> es (de la empresa o algo <b>personal del dueno</b>). Despues, el <b>Reporte de Gastos por "
        "categoria</b> junta todo (estos movimientos + las facturas) y te muestra en que se te va la plata, filtrando por "
        "categoria, por empresa/propio y por caja o persona.", st_intro))
    E.append(callout("<b>El circuito en una linea:</b> &nbsp; armas el <b>arbol de Categorias de Gasto</b> &rarr; cargas cada "
                     "gasto en <b>Movimientos diarios</b> (categoria + de quien + como se pago) &rarr; lo ves agrupado en el "
                     "<b>Reporte de Gastos por categoria</b> con filtros.", G100, G600, G900))

    # PASO 1 - categorias
    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Armar el arbol de Categorias de Gasto (una vez)", st_h2))
    E.append(Paragraph("Las categorias son tuyas: las armas como quieras, con el nivel de detalle que te sirva.", st_intro))
    E.append(steps([
        "Anda a <b>Administracion &rarr; Categorias de Gasto</b>.",
        "Arma el arbol <b>Categoria &rarr; Familia &rarr; subfamilias</b>. Ej.: <b>Vehiculos</b> (Combustible, Service, "
        "Cubiertas), <b>Estructura</b> (Luz, Telefono, Internet), <b>Personal</b> (Comida, Viaticos), <b>Impuestos y tasas</b>, etc.",
        "La primera vez el arbol se <b>siembra solo</b> e importa las categorias que ya venias usando. Podes agregar, renombrar "
        "o borrar cuando quieras.",
    ]))
    E.append(callout("<b>Consejo:</b> no hace falta una categoria por cada cosa. Pocas categorias claras (10-15) con sus "
                     "familias alcanzan y hacen el reporte mucho mas util que decenas de categorias sueltas.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 2 - cargar gasto
    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Cargar un gasto (o ingreso) del dia", st_h2))
    E.append(steps([
        "Anda a <b>Tesoreria &rarr; Movimientos diarios</b> (o desde la pantalla de Inicio con la accion rapida) y toca "
        "<b>+ Nuevo</b>.",
        "Elegi <b>Egreso</b> (pago/gasto) o <b>Ingreso</b> (cobro/venta) y la <b>fecha</b>.",
        "Escribi el <b>Concepto</b> (ej. “Almuerzo equipo”, “Combustible camioneta”).",
        "Elegi la <b>Categoria</b> y la <b>Familia</b> del arbol (es lo que agrupa el reporte).",
        "Elegi <b>De quien es</b> con <b>Clasificacion</b>: <b>\U0001F3E2 Empresa</b> o <b>\U0001F464 Personal del dueno</b>.",
        "Carga el <b>Monto</b> y, opcional, la <b>Contraparte</b> (a quien le pagaste / de quien cobraste).",
        "Elegi el <b>Metodo de pago</b> y su dato: <b>Efectivo</b> (caja), <b>Cheque</b> (de cartera), <b>Transferencia/Debito</b> "
        "(cuenta bancaria), <b>Billetera/medio externo</b>, <b>\U0001F4B3 Tarjeta</b> o <b>Intercompany</b> (otra firma del grupo "
        "paga).",
        "Guarda. El sistema arma <b>solo</b> el movimiento correcto (caja de Efectivo, movimiento del Banco o entrega del "
        "cheque): vos no te preocupas por eso.",
    ]))
    E.append(callout("<b>Empresa vs Personal del dueno:</b> marca <b>Personal</b> los gastos del dueno/socio que salen de la "
                     "plata de la empresa pero no son del campo (ej. gastos de la casa). Asi despues los podes <b>separar</b> en "
                     "el reporte y no se mezclan con los gastos del negocio.", AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(callout("<b>Por caja / tenedor:</b> si usas cajas con el nombre de cada persona (Lucas, Mariano, Oficina), al pagar "
                     "en efectivo elegis esa caja. Despues podes ver en el reporte <b>cuanto gasto cada uno</b>.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 3 - ver listado
    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Ver y corregir los movimientos del mes", st_h2))
    E.append(bullets([
        "En <b>Movimientos diarios</b> tenes el <b>listado</b> con filtros (fecha, tipo, metodo, categoria, clasificacion y "
        "buscador) y los <b>KPI del mes</b> (ingresos / egresos / neto) con el total de lo filtrado.",
        "Cada movimiento se puede <b>editar ✏️</b> o <b>eliminar \U0001F5D1️</b> (si lo cargaste a mano). Al editar "
        "podes cambiar la categoria, el de quien, el monto o el metodo.",
    ]))

    # PASO 4 - reporte
    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; El Reporte de Gastos por categoria", st_h2))
    E.append(Paragraph("Es la foto de en que se te va la plata. Junta <b>las facturas de compra</b> y <b>los Movimientos "
                       "diarios</b> por su categoria.", st_intro))
    E.append(steps([
        "Anda a <b>Tablero &rarr; \U0001F9FE Gastos por categoria</b>.",
        "Elegi el <b>rango de fechas</b> (Desde / Hasta) — por defecto, el ano en curso.",
        "Usa los filtros: <b>De quien</b> (Todos / \U0001F3E2 Empresa / \U0001F464 Personal del dueno) y "
        "<b>Caja / tenedor / contraparte</b> (escribi un nombre para ver solo los gastos de esa persona o proveedor).",
        "Tildas o no <b>Incluir movimientos diarios</b> (viene tildado) e <b>Incluir compras de insumos/mercaderia</b> "
        "(por defecto NO, para ver solo gastos).",
        "Toca <b>Aplicar</b>. Vas a ver el <b>total del periodo</b>, la <b>torta</b> de las mayores categorias y la tabla "
        "<b>Categoria &rarr; Familia</b> con su importe y % del total. Con <b>⬇️ Excel</b> lo descargas.",
    ]))
    E.append(callout("<b>Recorda:</b> el reporte es de la <b>empresa activa</b>. Para ver otra, cambiala arriba a la izquierda. "
                     "Y no cuenta dos veces: un pago de factura en efectivo se cuenta por su factura, no como gasto suelto.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # Buenas practicas
    E.append(Paragraph("Buenas practicas para que el reporte sirva", st_h2))
    E.append(bullets([
        "Elegi <b>siempre</b> la categoria al cargar (no la dejes vacia): lo que queda sin categoria aparece aparte como "
        "“(Sin categoria)”.",
        "Usa la clasificacion <b>Empresa / Personal del dueno</b> con criterio, asi podes mirar el negocio limpio de gastos "
        "personales.",
        "Si usas cajas por persona, cargalas con el <b>mismo nombre</b> siempre (ej. “Lucas”), para poder filtrar "
        "despues por tenedor.",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Cargue un gasto en Movimientos diarios y no aparece en el reporte. Por que?",
         "Fijate tres cosas: (1) que le hayas puesto una Categoria del arbol; (2) que el rango de fechas incluya la fecha del gasto; (3) que tengas tildado 'Incluir movimientos diarios'. Si filtraste por Empresa/Propio o por una caja, puede estar quedando afuera por el filtro."),
        ("Que diferencia hay entre cargar un gasto aca y cargar una factura de compra?",
         "La factura de compra es el comprobante fiscal (con IVA, proveedor y cuenta a pagar). Movimientos diarios es para el gasto del dia a dia que pagas en el momento (con o sin factura). Los dos entran al Reporte de Gastos por su categoria."),
        ("Pague una factura de compra en efectivo. Se cuenta dos veces en el reporte?",
         "No. El reporte cuenta la factura por su categoria y NO cuenta el pago en efectivo como gasto suelto. Solo cuenta como gasto los movimientos diarios cargados a mano (con su categoria)."),
        ("Puedo ver cuanto gasto cada persona (caja/tenedor)?",
         "Si. Cargando las cajas con el nombre de cada uno y usando el filtro 'Caja / tenedor / contraparte' en el reporte. Tambien podes ver el detalle por caja en Tesoreria -> Control de efectivo."),
        ("Separo los gastos personales del dueno de los del campo?",
         "Si. Al cargar elegis 'Personal del dueno' y en el reporte filtras 'De quien' = Personal del dueno (o Empresa para ver solo el negocio)."),
        ("Los gastos viejos (de antes de esta version) aparecen en el reporte?",
         "Los nuevos quedan vinculados a la categoria perfecto. Los viejos entran si su texto de categoria coincide con una categoria del arbol; si no, caen en '(Sin categoria)'. De ahi en adelante, cargando normal, queda todo prolijo."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
