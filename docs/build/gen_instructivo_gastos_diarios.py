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
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Gastos diarios", st_title))
    E.append(Paragraph("De la categoría al reporte: cargar los gastos del día a día y ver mes a mes cuánto, de quién y de qué son", st_sub))
    E.append(Paragraph(
        "Todos los días hay gastos chicos y medianos: combustible, comida del equipo, repuestos, un flete, un adelanto, "
        "servicios... En AgroCore se cargan en un solo lugar, <b>Movimientos diarios</b>, eligiendo la <b>categoría</b> del "
        "gasto y <b>de quién</b> es (de la empresa o algo <b>personal del dueño</b>). Después, el <b>Reporte de Gastos por "
        "categoría</b> junta todo (estos movimientos + las facturas) y te muestra en qué se te va la plata, filtrando por "
        "categoría, por empresa/propio y por caja o persona.", st_intro))
    E.append(callout("<b>El circuito en una línea:</b> &nbsp; armás el <b>árbol de Categorías de Gasto</b> &rarr; cargás cada "
                     "gasto en <b>Movimientos diarios</b> (categoría + de quién + cómo se pagó) &rarr; lo ves agrupado en el "
                     "<b>Reporte de Gastos por categoría</b> con filtros.", G100, G600, G900))

    # PASO 1 - categorias
    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Armar el árbol de Categorías de Gasto (una vez)", st_h2))
    E.append(Paragraph("Las categorías son tuyas: las armás como quieras, con el nivel de detalle que te sirva.", st_intro))
    E.append(steps([
        "Andá a <b>Administración &rarr; Categorías de Gasto</b>.",
        "Armá el árbol <b>Categoría &rarr; Familia &rarr; subfamilias</b>. Ej.: <b>Vehículos</b> (Combustible, Service, "
        "Cubiertas), <b>Estructura</b> (Luz, Teléfono, Internet), <b>Personal</b> (Comida, Viáticos), <b>Impuestos y tasas</b>, etc.",
        "La primera vez el árbol se <b>siembra solo</b> e importa las categorías que ya venías usando. Podés agregar, renombrar "
        "o borrar cuando quieras.",
    ]))
    E.append(callout("<b>Consejo:</b> no hace falta una categoría por cada cosa. Pocas categorías claras (10-15) con sus "
                     "familias alcanzan y hacen el reporte mucho más útil que decenas de categorías sueltas.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 2 - cargar gasto
    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Cargar un gasto (o ingreso) del día", st_h2))
    E.append(steps([
        "Andá a <b>Tesorería &rarr; Movimientos diarios</b> (o desde la pantalla de Inicio con la acción rápida) y tocá "
        "<b>+ Nuevo</b>.",
        "Elegí <b>Egreso</b> (pago/gasto) o <b>Ingreso</b> (cobro/venta) y la <b>fecha</b>.",
        "Escribí el <b>Concepto</b> (ej. “Almuerzo equipo”, “Combustible camioneta”).",
        "Elegí la <b>Categoría</b> y la <b>Familia</b> del árbol (es lo que agrupa el reporte).",
        "Elegí <b>De quién es</b> con <b>Clasificación</b>: <b>\U0001F3E2 Empresa</b> o <b>\U0001F464 Personal del dueño</b>.",
        "Cargá el <b>Monto</b> y, opcional, la <b>Contraparte</b> (a quién le pagaste / de quién cobraste).",
        "Elegí el <b>Método de pago</b> y su dato: <b>Efectivo</b> (caja), <b>Cheque</b> (de cartera), <b>Transferencia/Débito</b> "
        "(cuenta bancaria), <b>Billetera/medio externo</b>, <b>\U0001F4B3 Tarjeta</b> o <b>Intercompany</b> (otra firma del grupo "
        "paga).",
        "Guardá. El sistema arma <b>solo</b> el movimiento correcto (caja de Efectivo, movimiento del Banco o entrega del "
        "cheque): vos no te preocupás por eso.",
    ]))
    E.append(callout("<b>Empresa vs Personal del dueño:</b> marcá <b>Personal</b> los gastos del dueño/socio que salen de la "
                     "plata de la empresa pero no son del campo (ej. gastos de la casa). Así después los podés <b>separar</b> en "
                     "el reporte y no se mezclan con los gastos del negocio.", AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(callout("<b>Por caja / tenedor:</b> si usás cajas con el nombre de cada persona (Lucas, Mariano, Oficina), al pagar "
                     "en efectivo elegís esa caja. Después podés ver en el reporte <b>cuánto gastó cada uno</b>.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 3 - ver listado
    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Ver y corregir los movimientos del mes", st_h2))
    E.append(bullets([
        "En <b>Movimientos diarios</b> tenés el <b>listado</b> con filtros (fecha, tipo, método, categoría, clasificación y "
        "buscador) y los <b>KPI del mes</b> (ingresos / egresos / neto) con el total de lo filtrado.",
        "Cada movimiento se puede <b>editar ✏️</b> o <b>eliminar \U0001F5D1️</b> (si lo cargaste a mano). Al editar "
        "podés cambiar la categoría, el de quién, el monto o el método.",
    ]))

    # PASO 4 - reporte
    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; El Reporte de Gastos por categoría", st_h2))
    E.append(Paragraph("Es la foto de en qué se te va la plata. Junta <b>las facturas de compra</b> y <b>los Movimientos "
                       "diarios</b> por su categoría.", st_intro))
    E.append(steps([
        "Andá a <b>Tablero &rarr; \U0001F9FE Gastos por categoría</b>.",
        "Elegí el <b>rango de fechas</b> (Desde / Hasta) — por defecto, el año en curso.",
        "Usá los filtros: <b>De quién</b> (Todos / \U0001F3E2 Empresa / \U0001F464 Personal del dueño) y "
        "<b>Caja / tenedor / contraparte</b> (escribí un nombre para ver solo los gastos de esa persona o proveedor).",
        "Tildás o no <b>Incluir movimientos diarios</b> (viene tildado) e <b>Incluir compras de insumos/mercadería</b> "
        "(por defecto NO, para ver solo gastos).",
        "Tocá <b>Aplicar</b>. Vas a ver el <b>total del período</b>, la <b>torta</b> de las mayores categorías y la tabla "
        "<b>Categoría &rarr; Familia</b> con su importe y % del total. Con <b>⬇️ Excel</b> lo descargás.",
    ]))
    E.append(callout("<b>Recordá:</b> el reporte es de la <b>empresa activa</b>. Para ver otra, cambiala arriba a la izquierda. "
                     "Y no cuenta dos veces: un pago de factura en efectivo se cuenta por su factura, no como gasto suelto.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # Buenas practicas
    E.append(Paragraph("Buenas prácticas para que el reporte sirva", st_h2))
    E.append(bullets([
        "Elegí <b>siempre</b> la categoría al cargar (no la dejes vacía): lo que queda sin categoría aparece aparte como "
        "“(Sin categoría)”.",
        "Usá la clasificación <b>Empresa / Personal del dueño</b> con criterio, así podés mirar el negocio limpio de gastos "
        "personales.",
        "Si usás cajas por persona, cargalas con el <b>mismo nombre</b> siempre (ej. “Lucas”), para poder filtrar "
        "después por tenedor.",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Cargué un gasto en Movimientos diarios y no aparece en el reporte. ¿Por qué?",
         "Fijate tres cosas: (1) que le hayas puesto una Categoría del árbol; (2) que el rango de fechas incluya la fecha del gasto; (3) que tengas tildado 'Incluir movimientos diarios'. Si filtraste por Empresa/Propio o por una caja, puede estar quedando afuera por el filtro."),
        ("¿Qué diferencia hay entre cargar un gasto acá y cargar una factura de compra?",
         "La factura de compra es el comprobante fiscal (con IVA, proveedor y cuenta a pagar). Movimientos diarios es para el gasto del día a día que pagás en el momento (con o sin factura). Los dos entran al Reporte de Gastos por su categoría."),
        ("Pagué una factura de compra en efectivo. ¿Se cuenta dos veces en el reporte?",
         "No. El reporte cuenta la factura por su categoría y NO cuenta el pago en efectivo como gasto suelto. Solo cuenta como gasto los movimientos diarios cargados a mano (con su categoría)."),
        ("¿Puedo ver cuánto gastó cada persona (caja/tenedor)?",
         "Sí. Cargando las cajas con el nombre de cada uno y usando el filtro 'Caja / tenedor / contraparte' en el reporte. También podés ver el detalle por caja en Tesorería -> Control de efectivo."),
        ("¿Separo los gastos personales del dueño de los del campo?",
         "Sí. Al cargar elegís 'Personal del dueño' y en el reporte filtrás 'De quién' = Personal del dueño (o Empresa para ver solo el negocio)."),
        ("¿Los gastos viejos (de antes de esta versión) aparecen en el reporte?",
         "Los nuevos quedan vinculados a la categoría perfecto. Los viejos entran si su texto de categoría coincide con una categoría del árbol; si no, caen en '(Sin categoría)'. De ahí en adelante, cargando normal, queda todo prolijo."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
